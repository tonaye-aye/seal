// Fake synced folder ("Household Admin"), read-only. Like a real document
// index it serves extracted text for PDFs. Photos have no text layer, so they
// come back as images for a vision model to read.

import {
  ConnectorError,
  manifestEntry,
  networkDelay,
  once,
  paginate,
  type ConnectorRuntime,
} from "./runtime.ts";
import { bytesToBase64 } from "./source.ts";
import type { DocumentImage, DocumentMeta, Page } from "./types.ts";

export interface DocumentConnector {
  list(cursor?: string): Promise<Page<DocumentMeta>>;
  get(id: string): Promise<DocumentMeta>;
  /** The document's text, or null when it has none (photos). */
  readText(id: string): Promise<string | null>;
  /** The file itself as base64, for images that need a vision model. */
  readImage(id: string): Promise<DocumentImage>;
}

type RawDocument = Omit<DocumentMeta, "hasText"> & {
  textPath?: string;
  textExtraction: "pdf-text" | "vision";
};

export function createDocumentConnector(runtime: ConnectorRuntime): DocumentConnector {
  const pageSize = manifestEntry(runtime, "documents").pageSize ?? 20;

  const load = once(async () => {
    const file = JSON.parse(await runtime.source.readText("documents/index.json")) as {
      documents: RawDocument[];
    };
    return file.documents;
  });

  function meta({ textPath: _textPath, textExtraction, ...rest }: RawDocument): DocumentMeta {
    return { ...rest, hasText: textExtraction === "pdf-text" };
  }

  async function find(id: string): Promise<RawDocument> {
    const doc = (await load()).find((d) => d.id === id);
    if (!doc) {
      throw new ConnectorError({
        connector: "documents",
        code: "not_found",
        status: 404,
        message: `No document with id ${id}.`,
      });
    }
    return doc;
  }

  return {
    async list(cursor) {
      await networkDelay(runtime, "documents");
      const page = paginate(await load(), pageSize, cursor);
      return { ...page, items: page.items.map(meta) };
    },

    async get(id) {
      await networkDelay(runtime, "documents");
      return meta(await find(id));
    },

    async readText(id) {
      if (runtime.scenarios.has("slow_documents")) {
        await runtime.sleep((4000 + runtime.random() * 2000) * runtime.latencyScale);
      } else {
        await networkDelay(runtime, "documents");
      }
      const doc = await find(id);
      // The seed keeps a description of the photo for people browsing the
      // files, but a real folder has no text for a photo. Serving it would
      // hand the agent the meter reading instead of making it look.
      if (doc.textExtraction !== "pdf-text" || !doc.textPath) return null;
      return runtime.source.readText(`documents/${doc.textPath}`);
    },

    async readImage(id) {
      await networkDelay(runtime, "documents");
      const doc = await find(id);
      if (!doc.mimeType.startsWith("image/")) {
        throw new ConnectorError({
          connector: "documents",
          code: "not_found",
          status: 415,
          message: `${doc.filename} is not an image.`,
        });
      }
      const bytes = await runtime.source.readBytes(`documents/${doc.path}`);
      return { mimeType: doc.mimeType, base64: bytesToBase64(bytes) };
    },
  };
}
