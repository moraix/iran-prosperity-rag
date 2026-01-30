import json
from sentence_transformers import SentenceTransformer

CHUNKS_PATH = "data/index/chunks.json"
OUTPUT_PATH = "vectors.jsonl"

model = SentenceTransformer("BAAI/bge-base-en-v1.5") 

with open(CHUNKS_PATH, "r", encoding="utf-8") as f:
    chunks = json.load(f)

with open(OUTPUT_PATH, "w", encoding="utf-8") as out:
    for chunk in chunks:
        emb = model.encode(chunk["text"]).tolist()

        record = {
            "id": str(chunk["chunk_id"]),
            "values": emb,
            "metadata": {
                "page": chunk["page"],
                "text": chunk["text"]
            }
        }

        out.write(json.dumps(record) + "\n")

print("vectors.jsonl ساخته شد")
