import { assert, describe, it } from "vitest";
import { prettyDomain } from "./prettyDomain";

describe("prettyDomain", () => {
	it.each([
		{ label: "undefined", raw: undefined, expected: "" },
		{ label: "null", raw: null, expected: "" },
		{ label: "empty string", raw: "", expected: "" },
		{ label: "whitespace-only string", raw: "   ", expected: "" },
		{ label: "plain URL", raw: "https://example.com", expected: "example.com" },
		{ label: "URL with surrounding whitespace", raw: "  https://example.com/path?x=1  ", expected: "example.com" },
		{ label: "URL with a non-default port", raw: "https://example.com:8080/path", expected: "example.com:8080" },
		{ label: "'origin:' prefix is stripped before parsing", raw: "origin:https://example.com", expected: "example.com" },
		{ label: "'x509_san_dns:' prefix stripped; bare domain has no scheme, so URL parsing fails and the stripped value is returned", raw: "x509_san_dns:example.com", expected: "example.com" },
		{ label: "unparseable string is returned unchanged", raw: "not a url", expected: "not a url" },
		{ label: "URL with an empty host falls back to the full value", raw: "file:///path/to/file", expected: "file:///path/to/file" },
	])("prettyDomain: $label", ({ raw, expected }) => {
		assert.equal(prettyDomain(raw), expected);
	});

	it("throws when given a truthy non-string value, because raw.trim() is called with no type check", () => {
		assert.throws(() => prettyDomain(42));
	});
});
