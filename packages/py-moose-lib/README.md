# Python Moose Lib

Python package which contains moose utils

## Column Autocomplete with MooseModel

For LSP autocomplete when working with columns, use `MooseModel` instead of `BaseModel`:

```python
from moose_lib import MooseModel, OlapTable

class User(MooseModel):
    user_id: int
    email: str

# Autocomplete works when typing User.user_id
query = f"SELECT {User.user_id:col}, {User.email:col} FROM users"
```

See [MooseModel Autocomplete Guide](docs/moose-model-autocomplete.md) for details.
