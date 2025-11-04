use crate::framework::core::infrastructure::table::{
    Column, ColumnType, DataEnum, EnumValue, IntType,
};
use crate::infrastructure::processes::kafka_clickhouse_sync::IPV4_PATTERN;
use itertools::Either;
use num_bigint::{BigInt, BigUint};
use regex::Regex;
use serde::de::{DeserializeSeed, Error, MapAccess, SeqAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{forward_to_deserialize_any, Deserializer, Serialize, Serializer};
use serde_json::Value;
use serde_json::{Number, Serializer as JsonSerializer};
use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt::{Display, Formatter, Write};
use std::marker::PhantomData;
use std::ops::Deref;
use std::str::FromStr;
use std::sync::LazyLock;

struct State {
    seen: bool,
}

trait SerializeValue {
    type Error: serde::ser::Error;

    fn serialize_value<T>(&mut self, value: &T) -> Result<(), Self::Error>
    where
        T: ?Sized + Serialize;
}
impl<S> SerializeValue for S
where
    S: SerializeMap,
{
    type Error = S::Error;

    fn serialize_value<T>(&mut self, value: &T) -> Result<(), Self::Error>
    where
        T: ?Sized + Serialize,
    {
        // must have called serialize_key first
        S::serialize_value(self, value)
    }
}

struct DummyWrapper<'a, T>(&'a mut T); // workaround so that implementations don't clash
impl<S> SerializeValue for DummyWrapper<'_, S>
where
    S: SerializeSeq,
{
    type Error = S::Error;

    fn serialize_value<T>(&mut self, value: &T) -> Result<(), Self::Error>
    where
        T: ?Sized + Serialize,
    {
        self.0.serialize_element(value)
    }
}

trait EnumInt {
    fn from_u8(u8: u8) -> Self;
    fn from_usize(usize: usize) -> Self;
}
impl EnumInt for u64 {
    fn from_u8(u8: u8) -> u64 {
        u8 as u64
    }
    fn from_usize(usize: usize) -> Self {
        usize as u64
    }
}
impl EnumInt for i64 {
    fn from_u8(u8: u8) -> i64 {
        u8 as i64
    }
    fn from_usize(usize: usize) -> i64 {
        usize as i64
    }
}

// Integer regex for arbitrary-precision comparisons - disallows leading zeros
static INTEGER_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^-?(?:0|[1-9]\d*)$").unwrap());

static INT256_MIN: LazyLock<BigInt> = LazyLock::new(|| {
    let mut value = BigInt::from(1u8);
    value <<= 255;
    -value
});
static INT256_MAX: LazyLock<BigInt> = LazyLock::new(|| {
    let mut value = BigInt::from(1u8);
    value <<= 255;
    value - 1
});
static UINT256_MAX: LazyLock<BigUint> = LazyLock::new(|| {
    let mut value = BigUint::from(1u8);
    value <<= 256usize;
    value - 1usize
});

fn check_uint_in_range(n: u64, int_type: &IntType) -> bool {
    match int_type {
        IntType::Int8 => n <= i8::MAX as u64,
        IntType::Int16 => n <= i16::MAX as u64,
        IntType::Int32 => n <= i32::MAX as u64,
        IntType::Int64 => n <= i64::MAX as u64,
        IntType::UInt8 => n <= u8::MAX as u64,
        IntType::UInt16 => n <= u16::MAX as u64,
        IntType::UInt32 => n <= u32::MAX as u64,
        IntType::UInt64
        | IntType::Int128
        | IntType::Int256
        | IntType::UInt128
        | IntType::UInt256 => true,
    }
}

fn check_str_in_range(n: &str, int_type: &IntType) -> bool {
    use num_traits::Zero;
    match int_type {
        IntType::Int8 | IntType::Int16 | IntType::Int32 | IntType::Int64 => {
            n.parse::<i64>().is_ok_and(|n| match int_type {
                IntType::Int8 => i8::MIN as i64 <= n && n <= i8::MAX as i64,
                IntType::Int16 => i16::MIN as i64 <= n && n <= i16::MAX as i64,
                IntType::Int32 => i32::MIN as i64 <= n && n <= i32::MAX as i64,
                _ => true,
            })
        }
        IntType::UInt8 | IntType::UInt16 | IntType::UInt32 | IntType::UInt64 => {
            n.parse::<u64>().is_ok_and(|n| match int_type {
                IntType::UInt8 => u8::MIN as u64 <= n && n <= u8::MAX as u64,
                IntType::UInt16 => u16::MIN as u64 <= n && n <= u16::MAX as u64,
                IntType::UInt32 => u32::MIN as u64 <= n && n <= u32::MAX as u64,
                _ => true,
            })
        }
        IntType::Int128 => n.parse::<i128>().is_ok(),
        IntType::UInt128 => n.parse::<u128>().is_ok(),
        IntType::Int256 => BigInt::parse_bytes(n.as_bytes(), 10)
            .is_some_and(|n| INT256_MIN.deref() <= &n && &n <= INT256_MAX.deref()),
        IntType::UInt256 => BigUint::parse_bytes(n.as_bytes(), 10)
            .is_some_and(|n| BigUint::zero() <= n && &n <= UINT256_MAX.deref()),
    }
}

fn check_int_in_range(n: i64, int_type: &IntType) -> bool {
    match int_type {
        IntType::Int8 => n >= i8::MIN as i64 && n <= i8::MAX as i64,
        IntType::Int16 => n >= i16::MIN as i64 && n <= i16::MAX as i64,
        IntType::Int32 => n >= i32::MIN as i64 && n <= i32::MAX as i64,
        IntType::Int64 | IntType::Int128 | IntType::Int256 => true,
        IntType::UInt8 => n >= 0 && n <= u8::MAX as i64,
        IntType::UInt16 => n >= 0 && n <= u16::MAX as i64,
        IntType::UInt32 => n >= 0 && n <= u32::MAX as i64,
        IntType::UInt128 | IntType::UInt256 | IntType::UInt64 => n >= 0,
    }
}

fn handle_enum_value<S: SerializeValue, E, T>(
    write_to: &mut S,
    enum_def: &DataEnum,
    v: T,
) -> Result<(), E>
where
    E: Error,
    T: Copy + PartialEq + EnumInt + Serialize + Display,
{
    if enum_def
        .values
        .iter()
        .enumerate()
        .any(|(i, ev)| match &ev.value {
            EnumValue::Int(value) => (T::from_u8(*value)) == v,
            // TODO: string enums have range 1..=length
            // we can skip the iteration
            EnumValue::String(_) => (T::from_usize(i)) == v,
        })
    {
        write_to.serialize_value(&v).map_err(E::custom)
    } else {
        Err(E::custom(format!("Invalid enum value: {v}")))
    }
}

struct ParentContext<'a> {
    parent: Option<&'a ParentContext<'a>>,
    field_name: Either<&'a str, usize>,
}
impl ParentContext<'_> {
    fn bump_index(&mut self) {
        match self.field_name {
            Either::Left(_) => {
                panic!("Expecting array index case")
            }
            Either::Right(ref mut i) => {
                *i += 1;
            }
        }
    }

    fn get_path(&self) -> String {
        add_path_component(parent_context_to_string(self.parent), self.field_name)
    }
}

struct ValueVisitor<'a, S: SerializeValue> {
    t: &'a ColumnType,
    required: bool,
    write_to: &'a mut S,
    context: ParentContext<'a>,
    jwt_claims: Option<&'a Value>,
}
impl<'de, S: SerializeValue> DeserializeSeed<'de> for &mut ValueVisitor<'_, S> {
    type Value = ();

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(self)
    }
}
impl<'de, S: SerializeValue> Visitor<'de> for &mut ValueVisitor<'_, S> {
    type Value = ();

    fn expecting(&self, formatter: &mut Formatter) -> std::fmt::Result {
        match self.t {
            ColumnType::Boolean => formatter.write_str("a boolean value"),
            ColumnType::Int(_) => formatter.write_str("an integer value"),
            ColumnType::Float(_) => formatter.write_str("a floating-point value"),
            ColumnType::String | ColumnType::FixedString { .. } => {
                formatter.write_str("a string value")
            }
            ColumnType::DateTime { .. } => formatter.write_str("a datetime value"),
            ColumnType::Enum(_) => formatter.write_str("an enum value"),
            ColumnType::Array { .. } => formatter.write_str("an array value"),
            ColumnType::Nested(_) => formatter.write_str("a nested object"),

            ColumnType::BigInt
            | ColumnType::Date
            | ColumnType::Date16
            | ColumnType::IpV4
            | ColumnType::IpV6
            | ColumnType::Decimal { .. }
            | ColumnType::Json(_)
            | ColumnType::Bytes => formatter.write_str("a value matching the column type"),
            ColumnType::Uuid => formatter.write_str("a UUID"),
            ColumnType::Nullable(inner) => {
                write!(formatter, "a nullable value of type {inner}")
            }
            ColumnType::NamedTuple(fields) => {
                write!(formatter, "an object with fields: ")?;
                for (i, (name, field_type)) in fields.iter().enumerate() {
                    if i > 0 {
                        write!(formatter, ", ")?;
                    }
                    write!(formatter, "{name}: {field_type}")?;
                }
                Ok(())
            }
            ColumnType::Map {
                key_type,
                value_type,
            } => {
                write!(
                    formatter,
                    "a map with key type {key_type} and value type {value_type}"
                )
            }
            ColumnType::Point
            | ColumnType::Ring
            | ColumnType::LineString
            | ColumnType::MultiLineString
            | ColumnType::Polygon
            | ColumnType::MultiPolygon => formatter.write_str("a value matching the column type"),
        }?;
        write!(formatter, " at {}", self.get_path())
    }

    fn visit_bool<E>(self, v: bool) -> Result<Self::Value, E>
    where
        E: Error,
    {
        match self.t {
            ColumnType::Boolean => self.write_to.serialize_value(&v).map_err(Error::custom),
            _ => Err(Error::invalid_type(serde::de::Unexpected::Bool(v), &self)),
        }
    }
    fn visit_i64<E>(self, v: i64) -> Result<Self::Value, E>
    where
        E: Error,
    {
        match self.t {
            ColumnType::Int(int_t) if check_int_in_range(v, int_t) => {
                self.write_to.serialize_value(&v).map_err(Error::custom)
            }
            ColumnType::Float(_) => self.write_to.serialize_value(&v).map_err(Error::custom),
            ColumnType::Decimal { .. } => self.write_to.serialize_value(&v).map_err(Error::custom),
            ColumnType::Enum(enum_def) => handle_enum_value(self.write_to, enum_def, v),
            ColumnType::Int(int_t) => {
                let is_unsigned = matches!(
                    int_t,
                    IntType::UInt8
                        | IntType::UInt16
                        | IntType::UInt32
                        | IntType::UInt64
                        | IntType::UInt128
                        | IntType::UInt256
                );
                if is_unsigned && v < 0 {
                    Err(Error::custom(format!(
                        "Negative value for {:?} at {}",
                        int_t,
                        self.get_path()
                    )))
                } else {
                    Err(Error::custom(format!(
                        "Integer out of range for {:?} at {}: {}",
                        int_t,
                        self.get_path(),
                        v
                    )))
                }
            }
            _ => Err(Error::invalid_type(serde::de::Unexpected::Signed(v), &self)),
        }
    }

    fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E>
    where
        E: Error,
    {
        match self.t {
            ColumnType::Int(int_t) if check_uint_in_range(v, int_t) => {
                self.write_to.serialize_value(&v).map_err(Error::custom)
            }
            ColumnType::Float(_) => self.write_to.serialize_value(&v).map_err(Error::custom),
            ColumnType::Decimal { .. } => self.write_to.serialize_value(&v).map_err(Error::custom),
            ColumnType::Enum(enum_def) => handle_enum_value(self.write_to, enum_def, v),
            ColumnType::Int(int_t) => Err(Error::custom(format!(
                "Integer out of range for {:?} at {}: {}",
                int_t,
                self.get_path(),
                v
            ))),
            _ => Err(Error::invalid_type(
                serde::de::Unexpected::Unsigned(v),
                &self,
            )),
        }
    }

    fn visit_f64<E>(self, v: f64) -> Result<Self::Value, E>
    where
        E: Error,
    {
        match self.t {
            ColumnType::DateTime { .. } => {
                let seconds = v.trunc() as i64;
                let nanos = ((v.fract() * 1_000_000_000.0).round() as u32).min(999_999_999);
                let date = chrono::DateTime::from_timestamp(seconds, nanos)
                    .ok_or(E::custom("Invalid timestamp"))?;
                self.write_to
                    .serialize_value(&date.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true))
                    .map_err(Error::custom)
            }
            ColumnType::Decimal { .. } => self.write_to.serialize_value(&v).map_err(Error::custom),
            ColumnType::Float(_) => self.write_to.serialize_value(&v).map_err(Error::custom),
            _ => Err(Error::invalid_type(serde::de::Unexpected::Float(v), &self)),
        }
    }

    fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
    where
        E: Error,
    {
        match self.t {
            ColumnType::Int(int_t) => {
                if !INTEGER_REGEX.is_match(v) {
                    return Err(Error::invalid_type(serde::de::Unexpected::Str(v), &self));
                }
                if !check_str_in_range(v, int_t) {
                    return Err(Error::invalid_type(serde::de::Unexpected::Str(v), &self));
                }
                self.write_to
                    .serialize_value(&serde_json::Number::from_str(v).unwrap())
                    .map_err(Error::custom)
            }
            ColumnType::Float(_) => {
                if let Ok(parsed) = v.parse::<f64>() {
                    return self
                        .write_to
                        .serialize_value(&parsed)
                        .map_err(Error::custom);
                }
                Err(Error::invalid_type(serde::de::Unexpected::Str(v), &self))
            }
            ColumnType::String | ColumnType::FixedString { .. } => {
                self.write_to.serialize_value(v).map_err(Error::custom)
            }
            ColumnType::DateTime { .. } => {
                chrono::DateTime::parse_from_rfc3339(v).map_err(|_| {
                    E::custom(format!("Invalid date format at {}", self.get_path()))
                })?;

                self.write_to.serialize_value(v).map_err(Error::custom)
            }
            ColumnType::IpV4 => {
                if IPV4_PATTERN.is_match(v) {
                    self.write_to.serialize_value(v).map_err(Error::custom)
                } else {
                    Err(E::custom(format!(
                        "Invalid IPv4 format at {}",
                        self.get_path()
                    )))
                }
            }
            ColumnType::IpV6 => {
                if std::net::Ipv6Addr::from_str(v).is_ok() {
                    self.write_to.serialize_value(v).map_err(Error::custom)
                } else {
                    Err(E::custom(format!(
                        "Invalid IPv6 format at {}",
                        self.get_path()
                    )))
                }
            }
            ColumnType::Decimal { .. } => {
                if DECIMAL_REGEX.is_match(v) {
                    self.write_to.serialize_value(v).map_err(Error::custom)
                } else {
                    Err(E::custom(format!(
                        "Invalid decimal format at {}",
                        self.get_path()
                    )))
                }
            }
            ColumnType::Date | ColumnType::Date16 => {
                if DATE_REGEX.is_match(v) {
                    self.write_to.serialize_value(v).map_err(Error::custom)
                } else {
                    Err(E::custom(format!(
                        "Invalid date format at {}",
                        self.get_path()
                    )))
                }
            }
            ColumnType::Enum(ref enum_def) => {
                if enum_def.values.iter().any(|ev| match &ev.value {
                    EnumValue::Int(_) => ev.name == v,
                    EnumValue::String(enum_value) => enum_value == v,
                }) {
                    self.write_to.serialize_value(v).map_err(Error::custom)
                } else {
                    Err(E::custom(format!(
                        "Invalid enum value at {}: {}",
                        self.get_path(),
                        v
                    )))
                }
            }
            ColumnType::Uuid if uuid::Uuid::parse_str(v).is_ok() => {
                self.write_to.serialize_value(v).map_err(Error::custom)
            }
            _ => Err(Error::invalid_type(serde::de::Unexpected::Str(v), &self)),
        }
    }

    fn visit_none<E>(self) -> Result<Self::Value, E>
    where
        E: Error,
    {
        if self.required {
            return Err(E::custom(format!(
                "Required value at {}, but is none",
                self.get_path()
            )));
        }
        self.write_to
            // type param of the None does not matter
            // we're writing null anyway
            .serialize_value(&None::<bool>)
            .map_err(Error::custom)
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E>
    where
        E: Error,
    {
        self.visit_none()
    }

    fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(self)
    }
    fn visit_seq<A>(self, seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        match self.t {
            ColumnType::Array {
                element_type: ref inner_type,
                element_nullable,
            } => {
                self.write_to
                    .serialize_value(&SeqAccessSerializer {
                        inner_type,
                        inner_required: *element_nullable,
                        seq: RefCell::new(seq),
                        _phantom_data: &PHANTOM_DATA,
                        context: &self.context,
                    })
                    .map_err(A::Error::custom)?;
                Ok(())
            }
            ColumnType::Point => {
                let types = [
                    ColumnType::Float(
                        crate::framework::core::infrastructure::table::FloatType::Float64,
                    ),
                    ColumnType::Float(
                        crate::framework::core::infrastructure::table::FloatType::Float64,
                    ),
                ];
                self.write_to
                    .serialize_value(&TupleSerializer {
                        element_types: &types,
                        seq: RefCell::new(seq),
                        _phantom_data: &PHANTOM_DATA,
                        context: &self.context,
                    })
                    .map_err(A::Error::custom)?;
                Ok(())
            }
            ColumnType::Ring | ColumnType::LineString => {
                let point = ColumnType::Point;
                self.write_to
                    .serialize_value(&SeqAccessSerializer {
                        inner_type: &point,
                        inner_required: true,
                        seq: RefCell::new(seq),
                        _phantom_data: &PHANTOM_DATA,
                        context: &self.context,
                    })
                    .map_err(A::Error::custom)?;
                Ok(())
            }
            ColumnType::MultiLineString | ColumnType::Polygon => {
                let line = ColumnType::LineString;
                self.write_to
                    .serialize_value(&SeqAccessSerializer {
                        inner_type: &line,
                        inner_required: true,
                        seq: RefCell::new(seq),
                        _phantom_data: &PHANTOM_DATA,
                        context: &self.context,
                    })
                    .map_err(A::Error::custom)?;
                Ok(())
            }
            ColumnType::MultiPolygon => {
                let poly = ColumnType::Polygon;
                self.write_to
                    .serialize_value(&SeqAccessSerializer {
                        inner_type: &poly,
                        inner_required: true,
                        seq: RefCell::new(seq),
                        _phantom_data: &PHANTOM_DATA,
                        context: &self.context,
                    })
                    .map_err(A::Error::custom)?;
                Ok(())
            }
            _ => Err(Error::invalid_type(serde::de::Unexpected::Seq, &self)),
        }
    }
    fn visit_map<A>(self, map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        match self.t {
            ColumnType::Nested(ref fields) => {
                let inner = DataModelVisitor::with_context(
                    &fields.columns,
                    Some(&self.context),
                    self.jwt_claims,
                );
                let serializer = MapAccessSerializer {
                    inner: RefCell::new(inner),
                    map: RefCell::new(map),
                    _phantom_data: &PHANTOM_DATA,
                };
                self.write_to
                    .serialize_value(&serializer)
                    .map_err(A::Error::custom)
            }
            ColumnType::NamedTuple(ref fields) => {
                let columns: Vec<Column> = fields
                    .iter()
                    .map(|(name, t)| {
                        let (required, data_type) = match t {
                            ColumnType::Nullable(inner) => (false, inner.as_ref().clone()),
                            _ => (true, t.clone()),
                        };
                        Column {
                            name: name.clone(),
                            data_type,
                            required,
                            unique: false,
                            primary_key: false,
                            default: None,
                            annotations: vec![],
                            comment: None,
                            ttl: None,
                        }
                    })
                    .collect();
                let inner =
                    DataModelVisitor::with_context(&columns, Some(&self.context), self.jwt_claims);
                let serializer = MapAccessSerializer {
                    inner: RefCell::new(inner),
                    map: RefCell::new(map),
                    _phantom_data: &PHANTOM_DATA,
                };
                self.write_to
                    .serialize_value(&serializer)
                    .map_err(A::Error::custom)
            }
            ColumnType::Map {
                key_type,
                value_type,
            } => {
                struct MapPassThrough<'de, 'a, MA: MapAccess<'de>> {
                    parent_context: &'a ParentContext<'a>,
                    key_type: &'a ColumnType,
                    value_type: &'a ColumnType,
                    map: RefCell<MA>,
                    _phantom_data: &'de PhantomData<()>,
                }
                impl<'de, MA: MapAccess<'de>> Serialize for MapPassThrough<'de, '_, MA> {
                    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
                    where
                        S: Serializer,
                    {
                        use serde::ser::Error;
                        let mut inner = serializer.serialize_map(None)?;

                        let mut map = self.map.borrow_mut();
                        while let Some(key) = map.next_key::<String>().map_err(S::Error::custom)? {
                            validate_map_key::<S::Error>(&key, self.key_type, self.parent_context)?;
                            inner.serialize_key(&key)?;
                            let mut value_visitor = ValueVisitor {
                                t: self.value_type,
                                required: true,
                                write_to: &mut inner,
                                context: ParentContext {
                                    parent: Some(self.parent_context),
                                    field_name: Either::Left(&key),
                                },
                                jwt_claims: None,
                            };
                            map.next_value_seed(&mut value_visitor)
                                .map_err(S::Error::custom)?;
                            value_visitor.context.field_name = Either::Left("");
                        }
                        inner.end().map_err(S::Error::custom)
                    }
                }
                let map = MapPassThrough {
                    parent_context: &self.context,
                    key_type,
                    value_type,
                    map: RefCell::new(map),
                    _phantom_data: &PhantomData,
                };
                self.write_to
                    .serialize_value(&map)
                    .map_err(A::Error::custom)
            }
            ColumnType::Json(opts) => self
                .write_to
                .serialize_value(&JsonPassThrough {
                    map: RefCell::new(map),
                    opts,
                    parent_context: &self.context,
                    _phantom_data: &PhantomData,
                })
                .map_err(A::Error::custom),
            t => {
                if matches!(
                    t,
                    ColumnType::Float(_)
                        | ColumnType::Decimal { .. }
                        | ColumnType::Int(_)
                        | ColumnType::BigInt
                ) {
                    use serde::Deserialize;
                    // arbitrary precision number is passed to deserializing visitors
                    // as a map with single string field "$serde_json::private::Number"
                    let arbitrary_precision = Number::deserialize(MapAccessWrapper {
                        map,
                        _phantom_data: &PHANTOM_DATA,
                    });
                    match arbitrary_precision {
                        Ok(number) => {
                            if let ColumnType::Int(int_t) = t {
                                if !check_str_in_range(number.as_str(), int_t) {
                                    return Err(A::Error::custom(format!(
                                        "Integer out of range for {:?} at {}: {}",
                                        int_t,
                                        self.get_path(),
                                        number
                                    )));
                                }
                            }
                            return self
                                .write_to
                                .serialize_value(&number)
                                .map_err(Error::custom);
                        }
                        Err(_) => {
                            // nothing to do. fall through to normal error
                        }
                    }
                }
                Err(A::Error::invalid_type(serde::de::Unexpected::Map, &self))
            }
        }
    }
}

struct MapAccessWrapper<'de, A: MapAccess<'de>> {
    map: A,
    _phantom_data: &'de PhantomData<()>,
}

impl<'de, A: MapAccess<'de>> Deserializer<'de> for MapAccessWrapper<'de, A> {
    type Error = A::Error;

    fn deserialize_any<V>(self, visitor: V) -> Result<V::Value, Self::Error>
    where
        V: Visitor<'de>,
    {
        visitor.visit_map(self.map)
    }

    forward_to_deserialize_any! {
        bool char str string bytes byte_buf option unit unit_struct
        newtype_struct seq tuple tuple_struct map struct enum identifier
        ignored_any i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64
    }
}

/// Validate a key string according to the given key type
fn validate_map_key<E>(
    key_str: &str,
    key_type: &ColumnType,
    context: &ParentContext,
) -> Result<(), E>
where
    E: serde::ser::Error,
{
    match key_type {
        ColumnType::String => Ok(()), // String keys are always valid
        ColumnType::Int(int_t) => {
            // Minimal logic using existing helpers, with test-aligned messages
            if !INTEGER_REGEX.is_match(key_str) {
                return Err(E::custom(format!(
                    "Invalid integer key '{}' for Map at {}",
                    key_str,
                    context.get_path()
                )));
            }

            let is_unsigned = matches!(
                int_t,
                IntType::UInt8
                    | IntType::UInt16
                    | IntType::UInt32
                    | IntType::UInt64
                    | IntType::UInt128
                    | IntType::UInt256
            );
            if is_unsigned && key_str.starts_with('-') {
                return Err(E::custom("Invalid unsigned integer key"));
            }

            if check_str_in_range(key_str, int_t) {
                Ok(())
            } else {
                Err(E::custom(format!("out of range {:?}", int_t)))
            }
        }
        ColumnType::Float(_) => {
            key_str.parse::<f64>().map_err(|_| {
                E::custom(format!(
                    "Invalid float key '{}' for Map at {}",
                    key_str,
                    context.get_path()
                ))
            })?;
            Ok(())
        }
        ColumnType::IpV4 => {
            if IPV4_PATTERN.is_match(key_str) {
                Ok(())
            } else {
                Err(E::custom(format!(
                    "Invalid IPv4 key '{}' for Map at {}",
                    key_str,
                    context.get_path()
                )))
            }
        }
        ColumnType::IpV6 => {
            if std::net::Ipv6Addr::from_str(key_str).is_ok() {
                Ok(())
            } else {
                Err(E::custom(format!(
                    "Invalid IPv6 key '{}' for Map at {}",
                    key_str,
                    context.get_path()
                )))
            }
        }
        ColumnType::Uuid => {
            uuid::Uuid::parse_str(key_str).map_err(|_| {
                E::custom(format!(
                    "Invalid UUID key '{}' for Map at {}",
                    key_str,
                    context.get_path()
                ))
            })?;
            Ok(())
        }
        _ => Err(E::custom(format!(
            "Unsupported key type {:?} for Map at {}",
            key_type,
            context.get_path()
        ))),
    }
}
impl<S: SerializeValue> ValueVisitor<'_, S> {
    fn get_path(&self) -> String {
        self.context.get_path()
    }
}

impl<'de, A: SeqAccess<'de>> Serialize for SeqAccessSerializer<'_, 'de, A> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut write_to = serializer.serialize_seq(None)?;
        let mut visitor = ValueVisitor {
            t: self.inner_type,
            required: self.inner_required,
            write_to: &mut DummyWrapper(&mut write_to),
            context: ParentContext {
                parent: Some(self.context),
                field_name: Either::Right(0),
            },
            jwt_claims: None,
        };
        let mut seq = self.seq.borrow_mut();
        while let Some(()) = seq
            .next_element_seed(&mut visitor)
            .map_err(serde::ser::Error::custom)?
        {
            visitor.context.bump_index();
        }
        write_to.end()
    }
}

static DATE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$").unwrap());
pub static DECIMAL_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^-?\d+(\.\d+)?$").unwrap());
static PHANTOM_DATA: PhantomData<()> = PhantomData {};
// RefCell for interior mutability
// generally serialization for T should not change the T
// but here we read elements/entries off from the SeqAccess/MapAccess
// as we put it into the output JSON
struct SeqAccessSerializer<'a, 'de, A: SeqAccess<'de>> {
    inner_type: &'a ColumnType,
    inner_required: bool,
    seq: RefCell<A>,
    _phantom_data: &'de PhantomData<()>,
    context: &'a ParentContext<'a>,
}
struct MapAccessSerializer<'de, 'a, A: MapAccess<'de>> {
    inner: RefCell<DataModelVisitor<'a>>,
    map: RefCell<A>,
    _phantom_data: &'de PhantomData<()>,
}

struct TupleSerializer<'a, 'de, A: SeqAccess<'de>> {
    element_types: &'a [ColumnType],
    seq: RefCell<A>,
    _phantom_data: &'de PhantomData<()>,
    context: &'a ParentContext<'a>,
}

impl<'de, A: SeqAccess<'de>> Serialize for TupleSerializer<'_, 'de, A> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut write_to = serializer.serialize_seq(None)?;
        let mut seq = self.seq.borrow_mut();

        for (idx, expected_type) in self.element_types.iter().enumerate() {
            let mut value_visitor = ValueVisitor {
                t: expected_type,
                required: true,
                write_to: &mut DummyWrapper(&mut write_to),
                context: ParentContext {
                    parent: Some(self.context),
                    field_name: Either::Right(idx),
                },
                jwt_claims: None,
            };

            match seq.next_element_seed(&mut value_visitor) {
                Ok(Some(())) => { /* wrote validated element */ }
                Ok(None) => {
                    return Err(serde::ser::Error::custom(format!(
                        "Invalid tuple length at {}: expected {} elements",
                        self.context.get_path(),
                        self.element_types.len()
                    )));
                }
                Err(e) => return Err(serde::ser::Error::custom(e)),
            }
        }

        // Ensure no extra items
        if let Some(_extra) = seq
            .next_element::<serde::de::IgnoredAny>()
            .map_err(serde::ser::Error::custom)?
        {
            return Err(serde::ser::Error::custom(format!(
                "Invalid tuple length at {}: unexpected extra element",
                self.context.get_path()
            )));
        }

        write_to.end()
    }
}

impl<'de, A: MapAccess<'de>> Serialize for MapAccessSerializer<'de, '_, A> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut write_to = serializer.serialize_map(None)?;
        let map: &mut A = &mut self.map.borrow_mut();
        self.inner
            .borrow_mut()
            .transfer_map_access_to_serialize_map(map, &mut write_to)
            .map_err(serde::ser::Error::custom)?;
        write_to.end()
    }
}

pub struct DataModelVisitor<'a> {
    columns: HashMap<String, (Column, State)>,
    parent_context: Option<&'a ParentContext<'a>>,
    jwt_claims: Option<&'a Value>,
}
impl<'a> DataModelVisitor<'a> {
    pub fn new(columns: &[Column], jwt_claims: Option<&'a Value>) -> Self {
        Self::with_context(columns, None, jwt_claims)
    }

    fn with_context(
        columns: &[Column],
        parent_context: Option<&'a ParentContext<'a>>,
        jwt_claims: Option<&'a Value>,
    ) -> Self {
        DataModelVisitor {
            columns: columns
                .iter()
                .map(|c| (c.name.clone(), (c.clone(), State { seen: false })))
                .collect(),
            parent_context,
            jwt_claims,
        }
    }

    fn transfer_map_access_to_serialize_map<'de, A: MapAccess<'de>, S: SerializeMap>(
        &mut self,
        map: &mut A,
        map_serializer: &mut S,
    ) -> Result<(), A::Error> {
        while let Some(key) = map.next_key::<String>()? {
            if let Some((column, state)) = self.columns.get_mut(&key) {
                state.seen = true;

                map_serializer
                    .serialize_key(&key)
                    .map_err(A::Error::custom)?;

                let mut visitor = ValueVisitor {
                    t: &column.data_type,
                    write_to: map_serializer,
                    required: column.required,
                    context: ParentContext {
                        parent: self.parent_context,
                        field_name: Either::Left(&key),
                    },
                    jwt_claims: self.jwt_claims,
                };
                map.next_value_seed(&mut visitor)?;
            } else {
                map.next_value::<serde::de::IgnoredAny>()?;
            }
        }
        let mut missing_fields: Vec<String> = Vec::new();
        for (column, state) in self.columns.values_mut() {
            if !state.seen && column.required && column.default.is_none() {
                let parent_path = parent_context_to_string(self.parent_context);
                let path = add_path_component(parent_path, Either::Left(&column.name));

                if is_nested_with_jwt(&column.data_type) {
                    if let Some(jwt_claims) = self.jwt_claims {
                        map_serializer
                            .serialize_key(&column.name)
                            .map_err(A::Error::custom)?;
                        map_serializer
                            .serialize_value(jwt_claims)
                            .map_err(A::Error::custom)?;
                    }
                } else {
                    missing_fields.push(path);
                }
            }
            state.seen = false
        }

        if !missing_fields.is_empty() {
            return Err(A::Error::custom(format!(
                "Missing fields: {}",
                missing_fields.join(", ")
            )));
        }

        Ok(())
    }
}

fn parent_context_to_string(parent_context: Option<&ParentContext>) -> String {
    match parent_context {
        Some(ParentContext { parent, field_name }) => {
            add_path_component(parent_context_to_string(*parent), *field_name)
        }
        None => String::new(),
    }
}

impl<'de> Visitor<'de> for &mut DataModelVisitor<'_> {
    type Value = Vec<u8>;

    fn expecting(&self, formatter: &mut Formatter) -> std::fmt::Result {
        formatter.write_str("an object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut vec = Vec::with_capacity(128);
        let mut writer = JsonSerializer::new(&mut vec);
        let mut map_serializer = writer.serialize_map(None).map_err(A::Error::custom)?;

        self.transfer_map_access_to_serialize_map(&mut map, &mut map_serializer)?;
        SerializeMap::end(map_serializer).map_err(A::Error::custom)?;

        Ok(vec)
    }
}
impl<'de> DeserializeSeed<'de> for &mut DataModelVisitor<'_> {
    type Value = Vec<u8>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(self)
    }
}
pub struct DataModelArrayVisitor<'a> {
    pub inner: DataModelVisitor<'a>,
}
impl<'de> Visitor<'de> for &mut DataModelArrayVisitor<'_> {
    type Value = Vec<Vec<u8>>;

    fn expecting(&self, formatter: &mut Formatter) -> std::fmt::Result {
        formatter.write_str("an array")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut result = vec![];
        while let Some(element) = seq.next_element_seed(&mut self.inner)? {
            result.push(element)
        }
        Ok(result)
    }

    fn visit_map<A>(self, map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        Ok(vec![self.inner.visit_map(map)?])
    }
}

fn add_path_component(mut path: String, field_name: Either<&str, usize>) -> String {
    if !path.is_empty() {
        path.push('.');
    }
    match field_name {
        Either::Left(field_name) => {
            path.push_str(field_name);
        }
        Either::Right(index) => {
            write!(path, "{index}").unwrap();
        }
    }

    path
}

fn is_nested_with_jwt(column_type: &ColumnType) -> bool {
    match column_type {
        ColumnType::Nested(nested) => nested.jwt,
        _ => false,
    }
}

struct JsonPassThrough<'de, 'a, MA: MapAccess<'de>> {
    map: RefCell<MA>,
    opts: &'a crate::framework::core::infrastructure::table::JsonOptions,
    parent_context: &'a ParentContext<'a>,
    _phantom_data: &'de PhantomData<()>,
}
impl<'de, 'a, MA: MapAccess<'de>> Serialize for JsonPassThrough<'de, 'a, MA> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::Error;

        // Group typed paths by their top-level key
        #[derive(Clone)]
        struct PathSpec {
            full: String,
            segments: Vec<String>,
            required: bool,
            seen: bool,
        }

        let mut by_top: HashMap<String, Vec<PathSpec>> = HashMap::new();
        for (p, t) in &self.opts.typed_paths {
            let required = !matches!(t, ColumnType::Nullable(_));
            let mut parts = p.split('.').map(|s| s.to_string());
            if let Some(top) = parts.next() {
                let rest: Vec<String> = parts.collect();
                by_top.entry(top).or_default().push(PathSpec {
                    full: p.clone(),
                    segments: rest,
                    required,
                    seen: false,
                });
            }
        }

        let mut inner = serializer.serialize_map(None)?;
        let mut map = self.map.borrow_mut();
        while let Some(key) = map.next_key::<String>().map_err(Error::custom)? {
            // Validate typed paths under this top-level key if any
            if let Some(path_specs) = by_top.get_mut(&key) {
                let v: Value = map.next_value::<Value>().map_err(Error::custom)?;

                // For each spec, walk the value to ensure presence (and not null)
                for spec in path_specs.iter_mut() {
                    let mut current = &v;
                    let mut missing = false;
                    for (i, seg) in spec.segments.iter().enumerate() {
                        match current {
                            Value::Object(obj) => {
                                if let Some(next) = obj.get(seg) {
                                    current = next;
                                } else {
                                    missing = true;
                                    break;
                                }
                            }
                            _ => {
                                // if there are remaining segments but not an object
                                if i < spec.segments.len() {
                                    missing = true;
                                    break;
                                }
                            }
                        }
                    }
                    if !missing && spec.required {
                        missing = current == &Value::Null;
                    }
                    if !missing {
                        spec.seen = true;
                    }
                }

                // write the original key/value to output
                inner.serialize_key(&key).map_err(S::Error::custom)?;
                SerializeMap::serialize_value(&mut inner, &v)?;
            } else {
                // Not a typed path top-level key, just forward
                inner.serialize_key(&key).map_err(S::Error::custom)?;
                SerializeMap::serialize_value(
                    &mut inner,
                    &map.next_value::<Value>().map_err(S::Error::custom)?,
                )?;
            }
        }

        // Check for any missing required typed paths
        let mut missing_paths: Vec<String> = Vec::new();
        for (_k, specs) in by_top.iter() {
            for spec in specs {
                if spec.required && !spec.seen {
                    // Prepend parent path (column name) to match error style
                    let parent = self.parent_context.get_path();
                    let path = if parent.is_empty() {
                        spec.full.clone()
                    } else {
                        format!("{}.{}", parent, spec.full)
                    };
                    missing_paths.push(path);
                }
            }
        }
        if !missing_paths.is_empty() {
            return Err(S::Error::custom(format!(
                "Missing fields: {}",
                missing_paths.join(", ")
            )));
        }

        inner.end().map_err(S::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{
        Column, ColumnType, DataEnum, EnumMember, EnumValue, FloatType, IntType, JsonOptions,
        Nested,
    };
    use num_bigint::{BigInt, BigUint};

    #[test]
    fn test_happy_path_all_types() {
        let columns = vec![
            Column {
                name: "string_col".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
            Column {
                name: "int_col".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
            Column {
                name: "float_col".to_string(),
                data_type: ColumnType::Float(FloatType::Float64),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
            Column {
                name: "bool_col".to_string(),
                data_type: ColumnType::Boolean,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
            Column {
                name: "date_col".to_string(),
                data_type: ColumnType::DateTime { precision: None },
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
        ];

        let json = r#"
        {
            "string_col": "test",
            "int_col": 42,
            "float_col": 3.14,
            "bool_col": true,
            "date_col": "2024-09-10T17:34:51+00:00"
        }
        "#;

        let result = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap();

        let expected = r#"{"string_col":"test","int_col":42,"float_col":3.14,"bool_col":true,"date_col":"2024-09-10T17:34:51+00:00"}"#;

        assert_eq!(String::from_utf8(result), Ok(expected.to_string()));
    }

    #[test]
    fn test_bad_date_format() {
        let columns = vec![Column {
            name: "date_col".to_string(),
            data_type: ColumnType::DateTime { precision: None },
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        let json = r#"
        {
            "date_col": "2024-09-10"
        }
        "#;

        let result = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));

        println!("{result:?}");
        assert!(result
            .err()
            .unwrap()
            .to_string()
            .contains("Invalid date format at date_col"));
    }

    #[test]
    fn test_array() {
        let columns = vec![Column {
            name: "array_col".to_string(),
            data_type: ColumnType::Array {
                element_type: Box::new(ColumnType::Int(IntType::Int64)),
                element_nullable: false,
            },
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        let json = r#"
        {
            "array_col": [1, 2, 3, 4, 5]
        }
        "#;

        let result = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap();

        let expected = r#"{"array_col":[1,2,3,4,5]}"#;

        assert_eq!(String::from_utf8(result), Ok(expected.to_string()));
    }

    #[test]
    fn test_enum_valid_and_invalid() {
        let columns = vec![Column {
            name: "enum_col".to_string(),
            data_type: ColumnType::Enum(DataEnum {
                name: "TestEnum".to_string(),
                values: vec![
                    EnumMember {
                        name: "Option1".to_string(),
                        value: EnumValue::String("option1".to_string()),
                    },
                    EnumMember {
                        name: "Option2".to_string(),
                        value: EnumValue::String("option2".to_string()),
                    },
                ],
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        // Test valid enum value
        let valid_json = r#"
        {
            "enum_col": "option1"
        }
        "#;

        let valid_result = serde_json::Deserializer::from_str(valid_json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap();

        let expected_valid = r#"{"enum_col":"option1"}"#;
        assert_eq!(
            String::from_utf8(valid_result),
            Ok(expected_valid.to_string())
        );

        // Test invalid enum value
        let invalid_json = r#"
        {
            "enum_col": "invalid_option"
        }
        "#;

        let invalid_result = serde_json::Deserializer::from_str(invalid_json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));

        assert!(invalid_result.is_err());
        assert!(invalid_result
            .unwrap_err()
            .to_string()
            .contains("Invalid enum value at enum_col: invalid_option"));
    }

    #[test]
    fn test_nested() {
        let nested_columns = vec![
            Column {
                name: "nested_string".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
            Column {
                name: "nested_int".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
                required: false,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
        ];

        let columns = vec![
            Column {
                name: "top_level_string".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
            Column {
                name: "nested_object".to_string(),
                data_type: ColumnType::Nested(Nested {
                    name: "nested".to_string(),
                    columns: nested_columns,
                    jwt: false,
                }),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
        ];

        // Test valid nested object
        let valid_json = r#"
        {
            "top_level_string": "hello",
            "nested_object": {
                "nested_string": "world",
                "nested_int": 42
            }
        }
        "#;

        let valid_result = serde_json::Deserializer::from_str(valid_json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap();

        let expected_valid = r#"{"top_level_string":"hello","nested_object":{"nested_string":"world","nested_int":42}}"#;
        assert_eq!(
            String::from_utf8(valid_result),
            Ok(expected_valid.to_string())
        );

        // Test invalid nested object (missing required field)
        let invalid_json = r#"
        {
            "top_level_string": "hello",
            "nested_object": {
                "nested_int": 42
            }
        }
        "#;

        let invalid_result = serde_json::Deserializer::from_str(invalid_json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));

        println!("{invalid_result:?}");
        assert!(invalid_result.is_err());
        assert!(invalid_result
            .unwrap_err()
            .to_string()
            .contains("Missing fields: nested_object.nested_string"));
    }

    #[test]
    fn test_missing_non_required_field() {
        let columns = vec![
            Column {
                name: "required_field".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
            Column {
                name: "optional_field".to_string(),
                data_type: ColumnType::Int(IntType::Int64),
                required: false,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
        ];

        let json = r#"
        {
            "required_field": "hello",
            "optional_field": null
        }
        "#;

        let result = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap();

        let expected = r#"{"required_field":"hello","optional_field":null}"#;
        assert_eq!(String::from_utf8(result), Ok(expected.to_string()));
    }

    #[test]
    fn test_jwt() {
        let nested_columns = vec![
            Column {
                name: "iss".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
            Column {
                name: "aud".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
            Column {
                name: "exp".to_string(),
                data_type: ColumnType::Float(FloatType::Float64),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
        ];

        let columns = vec![
            Column {
                name: "top_level_string".to_string(),
                data_type: ColumnType::String,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
            Column {
                name: "jwt_object".to_string(),
                data_type: ColumnType::Nested(Nested {
                    name: "nested".to_string(),
                    columns: nested_columns,
                    jwt: true,
                }),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                annotations: vec![],
                comment: None,
                ttl: None,
            },
        ];

        // JWT purposely missing in the request
        let valid_json = r#"
        {
            "top_level_string": "hello"
        }
        "#;

        // Fake JWT claims to pass to the visitor
        let jwt_claims = serde_json::json!({
            "iss": "issuer",
            "aud": "audience",
            "exp": 2043418466
        });

        let valid_result = serde_json::Deserializer::from_str(valid_json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, Some(&jwt_claims)))
            .unwrap();

        // Visitor should've injected the jwt claims
        let expected_valid = format!(r#"{{"top_level_string":"hello","jwt_object":{jwt_claims}}}"#);

        assert_eq!(
            String::from_utf8(valid_result),
            Ok(expected_valid.to_string())
        );
    }

    #[test]
    fn test_map_validation() {
        let columns = vec![Column {
            name: "user_scores".to_string(),
            data_type: ColumnType::Map {
                key_type: Box::new(ColumnType::String),
                value_type: Box::new(ColumnType::Int(IntType::Int64)),
            },
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        // Test valid map
        let valid_json = r#"
        {
            "user_scores": {
                "alice": 100,
                "bob": 85,
                "charlie": 92
            }
        }
        "#;

        let valid_result = serde_json::Deserializer::from_str(valid_json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap();

        let expected_valid = r#"{"user_scores":{"alice":100,"bob":85,"charlie":92}}"#;
        assert_eq!(
            String::from_utf8(valid_result),
            Ok(expected_valid.to_string())
        );

        // Test invalid map (wrong value type)
        let invalid_json = r#"
        {
            "user_scores": {
                "alice": "not_a_number",
                "bob": 85
            }
        }
        "#;

        let invalid_result = serde_json::Deserializer::from_str(invalid_json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));

        assert!(invalid_result.is_err());
        let error = invalid_result.unwrap_err();
        println!("{error}");
        assert!(error.to_string().contains(r#"invalid type: string "not_a_number", expected an integer value at user_scores.alice at line"#));
    }

    #[test]
    fn test_map_with_numeric_keys() {
        let columns = vec![Column {
            name: "id_to_name".to_string(),
            data_type: ColumnType::Map {
                key_type: Box::new(ColumnType::Int(IntType::Int64)),
                value_type: Box::new(ColumnType::String),
            },
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        // Test valid map with numeric keys (as strings in JSON)
        let valid_json = r#"
        {
            "id_to_name": {
                "123": "Alice",
                "456": "Bob"
            }
        }
        "#;

        let valid_result = serde_json::Deserializer::from_str(valid_json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap();

        let expected_valid = r#"{"id_to_name":{"123":"Alice","456":"Bob"}}"#;
        assert_eq!(
            String::from_utf8(valid_result),
            Ok(expected_valid.to_string())
        );

        // Test invalid map with non-numeric keys
        let invalid_json = r#"
        {
            "id_to_name": {
                "not_a_number": "Alice",
                "456": "Bob"
            }
        }
        "#;

        let invalid_result = serde_json::Deserializer::from_str(invalid_json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));

        assert!(invalid_result.is_err());
        assert!(invalid_result
            .unwrap_err()
            .to_string()
            .contains("Invalid integer key"));
    }

    #[test]
    fn test_uint8_range_boundaries() {
        let columns = vec![Column {
            name: "u8_col".to_string(),
            data_type: ColumnType::Int(IntType::UInt8),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        // Min boundary 0
        let json = r#"{ "u8_col": 0 }"#;
        let result = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok(), "expected 0 to be valid UInt8");

        // Max boundary 255
        let json = r#"{ "u8_col": 255 }"#;
        let result = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok(), "expected 255 to be valid UInt8");

        // Above max 256
        let json = r#"{ "u8_col": 256 }"#;
        let err = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("out of range") && msg.contains("UInt8"));

        // Negative value
        let json = r#"{ "u8_col": -1 }"#;
        let err = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Negative value") || msg.contains("invalid type"));
    }

    #[test]
    fn test_int16_range_boundaries() {
        let columns = vec![Column {
            name: "i16_col".to_string(),
            data_type: ColumnType::Int(IntType::Int16),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        // Min boundary -32768
        let json = r#"{ "i16_col": -32768 }"#;
        let result = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok(), "expected -32768 to be valid Int16");

        // Max boundary 32767
        let json = r#"{ "i16_col": 32767 }"#;
        let result = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok(), "expected 32767 to be valid Int16");

        // Above max 32768
        let json = r#"{ "i16_col": 32768 }"#;
        let err = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("out of range") && msg.contains("Int16"));

        // Below min -32769
        let json = r#"{ "i16_col": -32769 }"#;
        let err = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("out of range") && msg.contains("Int16"));
    }

    #[test]
    fn test_int128_range_boundaries() {
        let columns = vec![Column {
            name: "i128_col".to_string(),
            data_type: ColumnType::Int(IntType::Int128),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        let positive_limit: BigInt = BigInt::from(1u8) << 127usize;
        let max = (positive_limit.clone() - BigInt::from(1u8)).to_string();
        let min = (-positive_limit.clone()).to_string();
        let max_plus_one = positive_limit.clone().to_string();
        let min_minus_one = (-positive_limit.clone() - BigInt::from(1u8)).to_string();

        let json = format!(r#"{{ "i128_col": {} }}"#, max);
        let result = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok(), "expected max Int128 value to be valid");

        let json = format!(r#"{{ "i128_col": {} }}"#, min);
        let result = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok(), "expected min Int128 value to be valid");

        let json = format!(r#"{{ "i128_col": {} }}"#, max_plus_one);
        let err = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("out of range") && msg.contains("Int128"));

        let json = format!(r#"{{ "i128_col": {} }}"#, min_minus_one);
        let err = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("out of range") && msg.contains("Int128"));
    }

    #[test]
    fn test_int256_range_boundaries() {
        let columns = vec![Column {
            name: "i256_col".to_string(),
            data_type: ColumnType::Int(IntType::Int256),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        let positive_limit: BigInt = BigInt::from(1u8) << 255usize;
        let max = (positive_limit.clone() - BigInt::from(1u8)).to_string();
        let min = (-positive_limit.clone()).to_string();
        let max_plus_one = positive_limit.clone().to_string();
        let min_minus_one = (-positive_limit.clone() - BigInt::from(1u8)).to_string();

        let json = format!(r#"{{ "i256_col": {} }}"#, max);
        let result = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok(), "expected max Int256 value to be valid");

        let json = format!(r#"{{ "i256_col": {} }}"#, min);
        let result = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok(), "expected min Int256 value to be valid");

        let json = format!(r#"{{ "i256_col": {} }}"#, max_plus_one);
        let err = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("out of range") && msg.contains("Int256"));

        let json = format!(r#"{{ "i256_col": {} }}"#, min_minus_one);
        let err = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("out of range") && msg.contains("Int256"));
    }

    #[test]
    fn test_uint256_range_boundaries() {
        let columns = vec![Column {
            name: "u256_col".to_string(),
            data_type: ColumnType::Int(IntType::UInt256),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        let limit: BigUint = BigUint::from(1u8) << 256usize;
        let max = (limit.clone() - BigUint::from(1u8)).to_string();
        let max_plus_one = limit.to_string();

        let json = r#"{ "u256_col": 0 }"#;
        let result = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok(), "expected 0 to be valid UInt256");

        let json = format!(r#"{{ "u256_col": {} }}"#, max);
        let result = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok(), "expected max UInt256 value to be valid");

        let json = format!(r#"{{ "u256_col": {} }}"#, max_plus_one);
        let err = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("out of range") && msg.contains("UInt256"));

        let json = r#"{ "u256_col": -1 }"#;
        let err = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Negative value") && msg.contains("UInt256"));
    }

    #[test]
    fn test_map_key_uint8_range() {
        let columns = vec![Column {
            name: "map_col".to_string(),
            data_type: ColumnType::Map {
                key_type: Box::new(ColumnType::Int(IntType::UInt8)),
                value_type: Box::new(ColumnType::String),
            },
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        // Valid keys
        let json = r#"{ "map_col": { "0": "a", "255": "b" } }"#;
        let result = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok());

        // Out of range key 256
        let json = r#"{ "map_col": { "256": "a" } }"#;
        let err = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        assert!(err.to_string().contains("out of range"));

        // Negative key -1
        let json = r#"{ "map_col": { "-1": "a" } }"#;
        let err = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        // It will fail to parse as u128 and produce an error
        let msg = err.to_string();
        assert!(msg.contains("Invalid unsigned integer key") || msg.contains("out of range"));
    }

    #[test]
    fn test_map_key_int256_range() {
        let columns = vec![Column {
            name: "map_col".to_string(),
            data_type: ColumnType::Map {
                key_type: Box::new(ColumnType::Int(IntType::Int256)),
                value_type: Box::new(ColumnType::String),
            },
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        let positive_limit: BigInt = BigInt::from(1u8) << 255usize;
        let min = (-positive_limit.clone()).to_string();
        let max = (positive_limit.clone() - BigInt::from(1u8)).to_string();
        let json = format!(r#"{{ "map_col": {{ "{}": "a", "{}": "b" }} }}"#, min, max);
        let result = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok());

        let max_plus_one = (BigInt::from(1u8) << 255usize).to_string();
        let json = format!(r#"{{ "map_col": {{ "{}": "a" }} }}"#, max_plus_one);
        let err = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        assert!(err.to_string().contains("out of range") && err.to_string().contains("Int256"));

        let min_minus_one = (-(BigInt::from(1u8) << 255usize) - BigInt::from(1u8)).to_string();
        let json = format!(r#"{{ "map_col": {{ "{}": "a" }} }}"#, min_minus_one);
        let err = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        assert!(err.to_string().contains("out of range") && err.to_string().contains("Int256"));
    }

    #[test]
    fn test_map_key_uint256_range() {
        let columns = vec![Column {
            name: "map_col".to_string(),
            data_type: ColumnType::Map {
                key_type: Box::new(ColumnType::Int(IntType::UInt256)),
                value_type: Box::new(ColumnType::String),
            },
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        let limit: BigUint = BigUint::from(1u8) << 256usize;
        let max = (limit.clone() - BigUint::from(1u8)).to_string();
        let json = format!(r#"{{ "map_col": {{ "0": "a", "{}": "b" }} }}"#, max);
        let result = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok());

        let max_plus_one = limit.to_string();
        let json = format!(r#"{{ "map_col": {{ "{}": "a" }} }}"#, max_plus_one);
        let err = serde_json::Deserializer::from_str(&json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        assert!(err.to_string().contains("out of range") && err.to_string().contains("UInt256"));

        let json = r#"{ "map_col": { "-1": "a" } }"#;
        let err = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        assert!(
            err.to_string().contains("Invalid unsigned integer key")
                || err.to_string().contains("Negative value")
        );
    }

    #[test]
    fn test_json_typed_paths_present() {
        let columns = vec![Column {
            name: "payload".to_string(),
            data_type: ColumnType::Json(JsonOptions {
                typed_paths: vec![
                    ("a.b".to_string(), ColumnType::String),
                    ("top".to_string(), ColumnType::Int(IntType::Int64)),
                ],
                ..Default::default()
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        let json = r#"
        {
            "payload": {
                "a": { "b": "hello" },
                "top": 1
            }
        }
        "#;

        let result = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None));
        assert!(result.is_ok());
    }

    #[test]
    fn test_json_typed_paths_missing() {
        let columns = vec![Column {
            name: "payload".to_string(),
            data_type: ColumnType::Json(JsonOptions {
                typed_paths: vec![("a.b".to_string(), ColumnType::String)],
                ..Default::default()
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        // missing nested path
        let json = r#"
        {
            "payload": {
                "a": {}
            }
        }
        "#;

        let err = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        assert!(err.to_string().contains("Missing fields: payload.a.b"));
    }

    #[test]
    fn test_json_typed_paths_null_is_missing() {
        let columns = vec![Column {
            name: "payload".to_string(),
            data_type: ColumnType::Json(JsonOptions {
                typed_paths: vec![("a.b".to_string(), ColumnType::String)],
                ..Default::default()
            }),
            required: true,
            unique: false,
            primary_key: false,
            default: None,
            annotations: vec![],
            comment: None,
            ttl: None,
        }];

        // null at the nested path counts as missing for non-nullable types
        let json = r#"
        {
            "payload": {
                "a": { "b": null }
            }
        }
        "#;

        let err = serde_json::Deserializer::from_str(json)
            .deserialize_any(&mut DataModelVisitor::new(&columns, None))
            .unwrap_err();
        assert!(err.to_string().contains("Missing fields: payload.a.b"));
    }
}
