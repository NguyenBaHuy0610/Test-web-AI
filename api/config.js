module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const config = {
    GROQ_API_KEY: process.env.GROQ_API_KEY || "",
    GROQ_SUPPORT_API_KEY: process.env.GROQ_SUPPORT_API_KEY || process.env.GROQ_API_KEY || "",
    GROQ_SUPPORT_MODEL: process.env.GROQ_SUPPORT_MODEL || "openai/gpt-oss-120b"
  };

  const body = `window.APP_CONFIG = ${JSON.stringify(config)};`;
  if (typeof res.status === "function") {
    if (typeof res.send === "function") {
      res.status(200).send(body);
    } else {
      res.status(200).end(body);
    }
  } else {
    res.writeHead(200);
    res.end(body);
  }
};

