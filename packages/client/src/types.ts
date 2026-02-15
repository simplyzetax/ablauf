export interface AblaufClientConfig {
	/** Base URL for the oRPC endpoint (e.g. "https://api.example.com/__ablauf") */
	url: string;
	/** Base URL for WebSocket connections. Defaults to url with protocol swapped to ws(s):// */
	wsUrl?: string;
	/** Include credentials (cookies) in requests */
	withCredentials?: boolean;
	/** Custom headers to send with requests */
	headers?: Record<string, string>;
}
