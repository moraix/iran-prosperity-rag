const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

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

    try {
      if (url.pathname !== "/api/chat") {
        return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
      }

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
      }

      // Check bindings early
      if (!env.AI) return json({ error: "Workers AI binding (AI) is missing" }, 500);
      if (!env.VECTORIZE) return json({ error: "Vectorize binding (VECTORIZE) is missing" }, 500);

      const body = await request.json().catch(() => ({}));
      const question = (body.question || "").toString().trim();
      const topK = Math.max(1, Math.min(Number(body.top_k ?? 5) || 5, 10));

      if (!question) return json({ error: "Missing question" }, 400);

      // 1) Embed question
      const emb = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [question] });
      const queryVector = emb?.data?.[0];
      if (!Array.isArray(queryVector)) {
        return json({ error: "Embedding failed", debug: emb }, 500);
      }

      // 2) Query Vectorize
      const matches = await env.VECTORIZE.query(queryVector, {
        topK,
        returnMetadata: "all",
      });

      const items = matches?.matches || [];
      if (!items.length) {
        return json({
          answer: "I don't know based on the provided documents.",
          sources: [],
        });
      }

      // 3) Build context + citations
      const pages = new Set();
      const urls = new Set();
      const ctx = [];

      for (const m of items) {
        const page = m?.metadata?.page;
        const urlSrc = m?.metadata?.url;
        const text = cleanText(m?.metadata?.text);

        if (!text) continue;

        ctx.push({ page, text });

        if (page !== null && page !== undefined && page !== "") pages.add(page);
        if (urlSrc) urls.add(urlSrc);
      }

      const context = ctx
        .slice(0, 5)
        .map((c, i) => `Chunk ${i + 1} (page ${c.page}): ${c.text}`)
        .join("\n\n");

      const sortedPages = Array.from(pages).sort((a, b) => Number(a) - Number(b));
      const pageCites = sortedPages.map((p) => `[p.${p}]`).join(" ");
      const urlCites = Array.from(urls).map((u) => `[${u}]`).join(" ");
      const citations = [pageCites, urlCites].filter(Boolean).join(" ");

      if (context.length < 600) {
        return json({
          answer: "I don't know based on the provided documents.",
          sources: [
            ...sortedPages.map((p) => `p.${p}`),
            ...Array.from(urls),
          ],
        });
      }

      // 4) LLM answer strictly using context
      const prompt = [
        "You are a QA assistant answering questions strictly from the provided CONTEXT.",
        "Rules:",
        "- Start directly with the answer. Do NOT say phrases like 'Based on the documents' or 'the answer is'.",
        "- Do NOT mention chunks, context, or internal references (e.g., 'Chunk 4').",
        "- Use ONLY the information in the CONTEXT.",
        "- If the answer is not explicitly stated, reply exactly: \"I don't know based on the provided documents.\"",
        "- Keep the answer concise and clear (max ~120 words).",
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

      const finalAnswer = cleanText(raw) || "I don't know based on the provided documents.";

      return json({
        answer: `${finalAnswer}\n\nSources: ${citations}`,
        sources: [
          ...sortedPages.map((p) => `p.${p}`),
          ...Array.from(urls),
        ],
      });
    } catch (err) {
      return json(
        {
          error: "Worker crashed",
          message: String(err?.message || err),
        },
        500
      );
    }
  },
};
