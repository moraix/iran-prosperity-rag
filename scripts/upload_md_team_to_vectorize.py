import json
import re
from sentence_transformers import SentenceTransformer

MD_PATH = "data/web_docs/ipp_team.md"
OUT_JSONL = "vectors_team.jsonl"

def clean_text(t: str) -> str:
    t = t.replace("\n", " ")
    t = re.sub(r"\s+", " ", t)
    return t.strip()

def chunk_text(text: str, chunk_size=900, overlap=150):
    chunks = []
    start = 0
    while start < len(text):
        end = min(len(text), start + chunk_size)
        chunks.append(text[start:end])
        start = end - overlap
        if start < 0:
            start = 0
        if end == len(text):
            break
    return chunks

model = SentenceTransformer("BAAI/bge-base-en-v1.5")

with open(MD_PATH, "r", encoding="utf-8") as f:
    raw = f.read()

text = clean_text(raw)
chunks = chunk_text(text)

with open(OUT_JSONL, "w", encoding="utf-8") as out:
    for i, ch in enumerate(chunks):
        emb = model.encode(ch).tolist()
        rec = {
            "id": f"web_team_{i}",
            "values": emb,
            "metadata": {
                "source": "ipp_team_page",
                "url": "https://fund.nufdiran.org/projects/ipp/team/",
                "page": None,
                "text": ch
            }
        }
        out.write(json.dumps(rec) + "\n")

print(f"Created {OUT_JSONL} with {len(chunks)} chunks")
