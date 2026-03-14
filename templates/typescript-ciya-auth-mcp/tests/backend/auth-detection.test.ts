import { describe, it, expect } from "vitest";
import { isJwt } from "../../packages/moosestack-service/app/apis/mcp";

describe("isJwt - token format detection", () => {
  it("returns true for a valid JWT format (3 dot-separated segments)", () => {
    // Real JWT structure: header.payload.signature
    const token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.signature";
    expect(isJwt(token)).toBe(true);
  });

  it("returns true for any string with exactly 3 dot-separated segments", () => {
    expect(isJwt("a.b.c")).toBe(true);
  });

  it("returns false for a PBKDF2 token (no dots)", () => {
    expect(isJwt("pbkdf2_sha256$260000$salt$hash")).toBe(false);
  });

  it("returns false for a simple API key with no dots", () => {
    expect(isJwt("sk_test_abc123def456")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isJwt("")).toBe(false);
  });

  it("returns false for a two-segment string", () => {
    expect(isJwt("header.payload")).toBe(false);
  });

  it("returns false for a four-segment string", () => {
    expect(isJwt("a.b.c.d")).toBe(false);
  });

  it("returns true for a string with leading dot (3 segments by count)", () => {
    // ".b.c" splits into ["", "b", "c"] = 3 segments
    // isJwt is a routing heuristic — jwtVerify is the actual security gate
    expect(isJwt(".b.c")).toBe(true);
  });

  it("returns true for a string with only dots (3 segments by count)", () => {
    // ".." splits into ["", "", ""] = 3 segments
    expect(isJwt("..")).toBe(true);
  });
});
