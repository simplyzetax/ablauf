import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { reportSuccess, reportError } from "./connection";

export function useWorkflowSSE(workflowId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_ABLAUF_API_URL ?? "http://localhost:8787";
    const url = `${baseUrl}/workflows/${workflowId}/sse`;
    const source = new EventSource(url);

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        queryClient.setQueryData(["workflow", workflowId], data);
        reportSuccess();
      } catch {
        // ignore parse errors
      }
    };

    source.onerror = () => {
      reportError("SSE connection lost");
      source.close();
    };

    return () => source.close();
  }, [workflowId, queryClient]);
}
