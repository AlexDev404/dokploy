/**
 * Sanitize database URL for safe logging
 * Removes password from connection string
 */
export function sanitizeDbUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.password) {
			parsed.password = "***";
		}
		return parsed.toString();
	} catch {
		// If URL parsing fails, use regex fallback
		return url.replace(/:[^:@]+@/, ":***@");
	}
}
