import { keccak256, toBytes } from "viem";

export type JobMetadataInput = {
  title: string;
  description: string;
  tags?: string[];
};

export function canonicalJobMetadataJson(input: JobMetadataInput): string {
  const tags = [...(input.tags ?? [])]
    .map((t) => t.trim())
    .filter(Boolean)
    .sort();
  return JSON.stringify({
    v: 1,
    title: input.title.trim(),
    description: input.description.trim(),
    tags,
  });
}

export function metadataContentHash(canonicalUtf8: string): `0x${string}` {
  return keccak256(toBytes(canonicalUtf8));
}
