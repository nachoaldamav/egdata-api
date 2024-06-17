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
      type?: string;
      value: string;
    }>
  | Map<string, { key: string; type: string; value: string }>;

export function attributesToObject(attributes: CustomAttributes): Record<
  string,
  {
    type: string;
    value: string;
  }
> {
  if (attributes instanceof Map) {
    const result = Array.from(attributes.values()).reduce(
      (acc, { key, type, value }) => {
        console.log(`key: ${key}, type: ${type}, value: ${value}`);
        acc[key] = { type, value };
        return acc;
      },
      {} as Record<string, { type: string; value: string }>
    );

    console.log(result);
    return result;
  }

  if (Array.isArray(attributes)) {
    return attributes.reduce((acc, { key, type, value }) => {
      if (!key) {
        console.error('Missing key in array item:', { key, type, value });
        return acc;
      }
      acc[key] = { type: type || 'STRING', value };
      return acc;
    }, {} as Record<string, { type: string; value: string }>);
  }

  // If the attributes is an object, directly return it assuming it matches the expected structure
  return attributes as Record<string, { type: string; value: string }>;
}
