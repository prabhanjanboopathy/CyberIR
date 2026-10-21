export const apiBaseUrl = (import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '/api/v1' : 'http://localhost:4000/api/v1')).replace(/\/$/, '')
