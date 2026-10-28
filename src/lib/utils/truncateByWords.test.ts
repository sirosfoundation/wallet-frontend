import { assert, describe, it } from "vitest";
import { truncateByWords } from "./truncateByWords";

describe("truncateByWords", () => {
	it.each([
		{
			label: "fits within maxLength: returned unchanged",
			input: "Hello world",
			maxLength: 20,
			expected: { text: "Hello world", truncated: false },
		},
		{
			label: "exact boundary fit: not truncated",
			input: "abc def",
			maxLength: 8,
			expected: { text: "abc def", truncated: false },
		},
		{
			label: "doesn't fit: truncated with '...' appended",
			input: "abc def",
			maxLength: 7,
			expected: { text: "abc...", truncated: true },
		},
		{
			label: "first word alone doesn't fit: returns just '...'",
			input: "hello",
			maxLength: 3,
			expected: { text: "...", truncated: true },
		},
		{
			label: "empty string input: returned unchanged",
			input: "",
			maxLength: 10,
			expected: { text: "", truncated: false },
		},
		{
			label: "skip-and-continue: an overlong middle word is dropped but a later shorter word is still kept",
			input: "a bbbbb c",
			maxLength: 5,
			expected: { text: "a c...", truncated: true },
		},
		{
			label: "double spaces preserved when nothing is truncated",
			input: "a  b",
			maxLength: 10,
			expected: { text: "a  b", truncated: false },
		},
		{
			label: "double spaces preserved even when a later word is truncated away",
			input: "a  bbbbb c",
			maxLength: 5,
			expected: { text: "a  c...", truncated: true },
		},
	])("$label", ({ input, maxLength, expected }) => {
		assert.deepEqual(truncateByWords(input, maxLength), expected);
	});
});
