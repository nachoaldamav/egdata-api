type CustomAttributes =
  | Record<
      string,
      {
        type: string;
        value: string;
      }
    >
  | Array<{
      key: string;
      type: string;
      value: string;
    }>;

export function attributesToObject(attributes: CustomAttributes): Record<
  string,
  {
    type: string;
    value: string;
  }
> {
  if (Array.isArray(attributes)) {
    return attributes.reduce((acc, { key, type, value }) => {
      acc[key] = { type, value };
      return acc;
    }, {} as Record<string, { type: string; value: string }>);
  }

  return attributes;
}
