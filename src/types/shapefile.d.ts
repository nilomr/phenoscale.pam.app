declare module 'shapefile' {
  interface Feature {
    geometry?: {
      type: 'Polygon' | 'MultiPolygon' | string;
      coordinates: number[][][] | number[][][][];
    };
    properties?: Record<string, any>;
  }

  export function read(shp: ArrayBuffer, dbf: ArrayBuffer): Promise<Feature[]>;
}
