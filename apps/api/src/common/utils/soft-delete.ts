/** Suffix a globally-unique value so it can be reused after the row is soft-deleted. */
export const releaseUnique = (value: string, id: string) => `${value}#del-${id}`;
