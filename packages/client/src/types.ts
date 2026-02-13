export interface AblaufClientConfig {
	/** Base URL for the oRPC endpoint (e.g. "https://api.example.com/__ablauf") */
	url: string;
	/** Include credentials (cookies) in requests */
	withCredentials?: boolean;
	/** Custom headers to send with requests */
	headers?: Record<string, string>;
}
