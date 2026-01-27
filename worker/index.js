const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function cleanText(t) {
  return (t || "")
    .replace(/\s+/g, " ")
    .replace(/\s([.,;:!?])/g, "$1")
    .trim();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
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
      const topK = Number(body.top_k ?? 5);

      if (!question) {
        return new Response(JSON.stringify({ error: "Missing question" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      // 1) Embed the question (768 dims) using Workers AI embedding model
      const emb = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [question],
      });

      const queryVector = emb?.data?.[0];
      if (!queryVector) {
        return new Response(JSON.stringify({ error: "Embedding failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      // 2) Vectorize similarity search
      const matches = await env.VECTORIZE.query(queryVector, {
        topK: Number.isFinite(topK) ? Math.max(1, Math.min(topK, 10)) : 5,
        returnMetadata: "all",
      });

      const results = matches?.matches || [];
      if (!results.length) {
        return new Response(
          JSON.stringify({
            answer: "I don't know based on the provided documents.",
            sources: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
      }

      // 3) Build context + citations
      const ctxChunks = [];
      const pages = new Set();

      for (const m of results) {
        const page = m?.metadata?.page;
        const text = cleanText(m?.metadata?.text);
        if (!text) continue;

        ctxChunks.push({ page, text });

        if (page !== null && page !== undefined && page !== "") {
          pages.add(page);
        }
      }

      const context = ctxChunks
        .slice(0, 5)
        .map((c, i) => `Chunk ${i + 1} (page ${c.page}): ${c.text}`)
        .join("\n\n");

      if (context.length < 600) {
        return new Response(
          JSON.stringify({
            answer: "I don't know based on the provided documents.",
            sources: Array.from(pages).sort((a, b) => Number(a) - Number(b)).map((p) => `p.${p}`),
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
      }

      const sortedPages = Array.from(pages).sort((a, b) => Number(a) - Number(b));
      const citations = sortedPages.map((p) => `[p.${p}]`).join(" ");

      // 4) Ask LLM strictly using the retrieved context
      const prompt = [
        "You are a QA assistant for a specific document set.",
        "Rules:",
        "- Answer ONLY using the CONTEXT below.",
        '- If the answer is not explicitly supported by the context, reply exactly: "I don\'t know based on the provided documents."',
        "- Do NOT guess or use outside knowledge.",
        "- Keep the answer concise (max ~120 words).",
        "",
        "CONTEXT:",
        context,
        "",
        `QUESTION: ${question}`,
        "ANSWER:",
      ].join("\n");

      const llm = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
        prompt,
        max_tokens: 220,
      });

      const raw =
        (llm && (llm.response || llm.result || llm.output_text)) ??
        (typeof llm === "string" ? llm : JSON.stringify(llm));

      const finalAnswer = cleanText(raw);

      // If model still hallucinates, the rule above usually prevents it,
      // but we keep a last-ditch guard: if it returns empty, refuse.
      const answer =
        finalAnswer.length > 0
          ? `${finalAnswer}\n\nSources: ${citations}`
          : `I don't know based on the provided documents.\n\nSources: ${citations}`;

      return new Response(
        JSON.stringify({
          answer,
          sources: sortedPages.map((p) => `p.${p}`),
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  },
};
