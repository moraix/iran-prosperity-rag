const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: CORS_HEADERS,
        });
      }

      const body = await request.json().catch(() => ({}));
      const question = (body.question || "").toString().trim();

      if (!question) {
        return new Response(JSON.stringify({ error: "Missing question" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      // Workers AI (binding name: AI, set in wrangler.jsonc)
      const result = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
        prompt: `Answer the question concisely.\n\nQuestion: ${question}\nAnswer:`,
        max_tokens: 200,
      });

      const answer =
        (result && (result.response || result.result || result.output_text)) ??
        (typeof result === "string" ? result : JSON.stringify(result));

      return new Response(JSON.stringify({ answer }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  },
};
