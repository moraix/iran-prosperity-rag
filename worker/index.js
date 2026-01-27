export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const body = await request.json().catch(() => ({}));
      const question = body.question || "";

      return Response.json({ answer: `Echo: ${question}` });
    }

    return new Response("Not Found", { status: 404 });
  },
};
