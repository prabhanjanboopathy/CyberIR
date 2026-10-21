export const formatDate = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
