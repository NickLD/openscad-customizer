export type ParamValue = number | string | boolean | number[];

export type ParamOption = { name: string; value: number | string };

/** One entry of OpenSCAD's `--export-format=param` output. Vectors have type 'number' and an array `initial`. */
export type Param = {
  name: string;
  group: string;
  caption?: string;
  type: 'number' | 'string' | 'boolean';
  initial: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: ParamOption[];
};

export type ParamSet = { title: string; parameters: Param[] };

/** Absolute virtual-FS path -> file bytes. */
export type FileMap = Map<string, Uint8Array>;

export type Route =
  | { kind: 'landing' }
  | {
      kind: 'repo';
      owner: string;
      repo: string;
      ref?: string;
      path?: string;
      preset?: string;
      /** Raw URL values, decoded later against the parameter list. */
      values: Record<string, string>;
    };
