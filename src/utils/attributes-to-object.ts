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

type Result = Record<string, { type: string; value: string }>;

export function attributesToObject(attributes: CustomAttributes): Result {
	if (attributes instanceof Map) {
		const res: Result = {};
		const text = JSON.stringify(Array.from(attributes.values()));

		const parsed = JSON.parse(text);
		for (const { key, type, value } of parsed) {
			if (!key) {
				console.error("Missing key in map item:", { key, type, value });
				continue;
			}
			res[key] = { type: type, value };
		}

		return res;
	}

	if (Array.isArray(attributes)) {
		return attributes.reduce(
			(acc, { key, type, value }) => {
				if (!key) {
					console.error("Missing key in array item:", { key, type, value });
					return acc;
				}
				acc[key] = { type: type || "STRING", value };
				return acc;
			},
			{} as Record<string, { type: string; value: string }>,
		);
	}

	// If the attributes is an object, directly return it assuming it matches the expected structure
	return attributes as Record<string, { type: string; value: string }>;
}
