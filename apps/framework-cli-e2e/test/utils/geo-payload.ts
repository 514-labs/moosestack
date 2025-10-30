import { TEST_DATA } from "../constants";

export const geoPayloadPy = (id: string) => ({
  id,
  timestamp: new Date(TEST_DATA.TIMESTAMP).toISOString(),
  point: [10, 20],
  ring: [
    [10, 20],
    [11, 21],
    [12, 22],
  ],
  line_string: [
    [0, 0],
    [1, 1],
    [2, 3],
  ],
  multi_line_string: [
    [
      [0, 0],
      [1, 1],
    ],
    [
      [2, 2],
      [3, 3],
    ],
  ],
  polygon: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
  multi_polygon: [
    [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
    [
      [
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
        [2, 2],
      ],
    ],
  ],
});
export const geoPayloadTs = (id: string) => {
  const payloadPy = geoPayloadPy(id);
  return {
    id: payloadPy.id,
    timestamp: payloadPy.timestamp,
    point: payloadPy.point,
    ring: payloadPy.ring,
    lineString: payloadPy.line_string,
    multiLineString: payloadPy.multi_line_string,
    polygon: payloadPy.polygon,
    multiPolygon: payloadPy.multi_polygon,
  };
};
