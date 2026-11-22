# Semantic core boundary

`src/core` contains the normalized model and pure transformations shared by all browser adapters. It must not import Chrome, Firefox, WXT entrypoints, browser globals, or DOM APIs.

Adapters convert browser-specific data to this contract. UI and browser entrypoints may consume the contract but must not define or mutate browser-specific fields on `SemanticNode`.

## Compression boundary

`compressSemanticTree(tree, level)` is the pure entry point for compression
profiles. It returns a new tree and never mutates its input. `without` is an
unpruned normalized clone; `detailed` additionally flattens only attribute-free
`generic` and `none`
wrappers, preserving child order, text, URLs and explicit states. The root is always
retained. Defined names/values/hrefs (including empty strings), levels and nonempty
states protect wrappers; empty state objects are normalized away. Adapter IDs alone
do not protect wrappers. Unnamed HTML form/section, Shadow DOM host/slot and empty
iframe/canvas placeholders may normalize to `generic` and be removed if they have
no semantic attributes. Focusable frame placeholders are retained. Capture warnings
remain available independently of compression.

`compact` removes only regression-tested noise: `InlineTextBox`,
empty or ancestor-duplicated `StaticText`/`image`, attribute-free `generic` or
`none` presentation wrappers, and selected empty structural leaves. `maximum` shares
the conservative `compact` structural policy; its export encoding follows redaction.

Compact also removes a complete ordered sequence of plain text fragments when
it exactly reconstructs a button or link name. Partial labels, visible column
labels and semantic boundaries remain intact. A textbox's plain text duplicate
of its own nonempty value is removed before redaction; value matching is case
sensitive and never uses `[REDACTED]` as a duplicate key. These local rules cross
only attribute-free presentation wrappers and retain controls and their states.
Heading and list levels remain explicit.

Compression receives normalized semantic data only. Chrome/CDP capture and
clipboard/download APIs remain outside this boundary.

## Semantic Text

`serializeSemanticText(tree)` renders an already-transformed tree in pre-order,
using two spaces per depth and a final newline. Text fields are JSON-quoted so
that newlines, tabs, quotes, and backslashes cannot produce extra node lines.
The serializer preserves explicit `false` and `mixed` states and returns a
`SerializedContext` whose `characterCount` is exactly `content.length`.

`serializeMarkdown(tree)` uses the same already-transformed tree and emits a
stable nested-list representation. JSON and raw-debug exports are intentionally
not exposed in the popup.

## Privacy and export preparation

`redactSemanticTree(tree, settings?)` is a pure, immutable, idempotent heuristic filter.
It redacts password values and common credential-shaped text in every
normalized text field before serialization. It returns only a replacement count
and never retains matched secret values. This is not a general PII or DLP
solution; adapters and UI must not claim it catches every secret.

Field rules also recognize editable semantic roles without a `value` property.
Full hiding covers every descendant name, value and link target; partial field
masking also follows named descendants. The field's own label remains visible.
The DOM adapter keeps input, textarea and select values out of ancestor names
so field values retain their label context. URL parameter rules decode names
once (percent escapes and `+` spaces), preserve case preferences, and replace
original value spans without rewriting unrelated URL text.

`prepareExport(tree, compressionLevel, format, redactSensitiveData, redactionSettings?)` is the only core orchestration
entry point for supported user exports. Its required order is:

```text
compress → redact (when enabled) → serialize
```

It supports `semantic-text` and `markdown`, and returns exact
character count, `ceil(characters / 4)` approximate token count, a reduction
ratio against the redacted Without output in the same format, and a redaction
count. It contains no browser APIs. Clipboard code belongs in the popup; Firefox file-download code runs in a
separate save entrypoint. Both consume only the already prepared serialized content.

The browser background entrypoint prepares the export and sends only final
content and counters to the popup. The popup does not receive the semantic tree
or run transforms. Browser-specific capture and message validation remain outside
the core; future browser adapters can call the same `prepareExport` function.

Export preparation reads the normalized input directly for Without, reuses its
selected size as the baseline, and counts other profiles' Without output through
the same rendering code without accumulating baseline lines or a full string.
Public compression functions still return independent trees. Compact's href
filter modifies only its owned clone, and ancestor label reference counts are
scoped to a single traversal. There is no retained capture cache.

Redaction skips the replacement passes for strings without any supported
credential marker. This fast check is a superset of the credential patterns;
adding a pattern requires updating the marker check and its regression cases.


## Maximum encoding

`prepareExport` applies Maximum encoding only to the already-redacted Compact tree.
It preserves every exported node occurrence, field, explicit state and child order.
Adapter IDs are not exported. Header placement and clipboard boundaries retain existing behavior.
Placeholders, accessible descriptions and inline errors remain quoted literal
attributes. They participate in subtree signatures and prevent attribute-free
chain/inline shorthand, without disabling packing for the whole page. Action
references still require the ordinary serializer; MCP Write keeps its separate
action-safe compression fallback.
Attribution uses the package version, the selected compression index times two
plus the privacy flag (`0`–`7`), and the author `V. Shkrobatskyi`. Direct serializers
without export settings include the version only. Maximum fallback retains the
requested profile code. The encoding legend has no internal format version. Metadata is never placed in a dictionary.

The self-contained legend describes quoted literals, explicit `key=value`
attributes, indentation, and the features actually used:

- Selective calibrated role aliases, such as `st=StaticText` and `li=listitem`.
  Aliases occupy role slots only; a conflicting original role prevents that alias.
  `button=bt` is excluded because calibration found no token benefit.
- Exact whole-string definitions `A="..."` through `Z="..."`. Bare references
  occupy name/value/href slots only; quoted `"A"` remains literal. Short candidates
  require three occurrences; two suffice when estimated literal cost covers the
  definition, references and uncertainty margin. Unsupported scripts and
  `[REDACTED]` stay literal. ASCII and bullet-mask text have local calibration.
- `cell+link NAME`, only for an attribute-free same-name cell with one link child;
  following children belong to the link. Both nodes remain present on expansion.
- `paragraph inline={...}` for supported unnamed, attribute-free paragraphs with
  exact StaticText leaves and nested code/strong groups. Semicolons retain sibling
  boundaries, and quotes retain whitespace; each string represents one text node.
- Exact repeated subtrees, defined under `T1:` etc. `@T1` inserts a fresh copy.
  Definition indentation is relative to its root. Definitions contain no subtree
  references; the final tree starts after `Page tree:`. Differences in states,
  values, levels, links or child order prevent sharing; IDs are ignored as before.

Selection compares at most eight combinations of chains, inline groups and exact
subtrees. Slot frequencies are counted in the selected representation, including
one copy of each definition. Thus parent packing cannot claim child savings twice.
Exact structural keys are interned without probabilistic hashes. Definitions are
flat, so they cannot form reference cycles. This bounded heuristic does not claim
globally optimal packing.

The separate character ledger counts escaping, all definitions, legends and line
breaks exactly. A small local lexical cost model, calibrated offline with
`cl100k_base` and `o200k_base`, estimates tokens. Candidate margins reject small
uncertain benefits. The complete payload must save at least 64 characters and 2%,
and at least 24 estimated tokens and 4%; otherwise serialization falls back to
Compact without an encoding legend. These are empirical guards, not guarantees for
arbitrary pages or other models. Popup `ceil(characters / 4)` remains an independent
rough estimate. No runtime tokenizer, network request, dependency or permission is
added.

Analysis is iterative and bounded to 100,000 nodes, depth 256, 4,096 interned
signatures and unique string candidates, 26 strings and 8 subtree definitions.
Inline groups allow at most 128 nodes and 4,096 encoded characters. Limit overflow
uses literal fragments or Compact fallback without truncation. New analysis limits
do not expand the existing capture/transform/legacy serializer depth contract.
All maps and cost caches belong to one export and are discarded afterwards.

Redaction settings default to the original built-in detectors plus email name/domain masking; full email hiding is off. Payment-card and IBAN hiding are on; phone and English personal-field masking are on; the corresponding full-hide presets are off. Each custom rule has one code-defined type: literal alternatives, a single literal, field-label substrings or whole words, URL parameters, Authorization, JWT, assigned secrets and Regex. Automatic email/phone/card/IBAN/personal-field types are built-in only. Literal types accept terms and optional case matching. Regex uses the bundled non-backtracking RE2JS engine, with bounded expression/program sizes, whole-match replacement, ignored empty matches and protected placeholders. Lookarounds and backreferences are unsupported. Field-label types hide values and nested text while preserving labels; URL parameters hide values after exact literal names. New alternative lists use ` / `; older single literals retain their behavior. Legacy combined modes migrate into separate typed rules with unique IDs; retired GitHub, AWS and OpenAI custom types migrate to equivalent escaped Regex expressions. V1–12 imports remain supported. V13 exports include an informational catalog of supported types; imported descriptions cannot define new detectors. All enabled matches are found in original strings and overlapping or adjacent spans are merged before replacement. Existing `[REDACTED]` placeholders are protected. The local tester can isolate an off rule and reports each rule's independent matches against the original sample. Browser-local persistence belongs to `src/redaction-settings.ts`; core receives validated settings without accessing storage.

Email types ignore matching text and case settings. Names and every domain label except the final suffix keep `min(3, floor(part.length / 2))` characters. Already masked parts stay stable. Full hiding wins over masking on overlapping original-text spans. The retired emailMask type migrates to emailMaskDomain. Settings migrate to envelope v6 under the same key; built-in mask states merge with logical OR while full-hiding state is preserved. V9/v10 catalogs remain supported for imports, including their retired type and built-in IDs.

Personal-data detectors are defined in `privacy/personal-data.ts` without additional dependencies. Automatic phone/card/IBAN types ignore matching text and case. Cards require 13–19 digits, reject repeated digits and check Luhn; IBANs require SWIFT registry country lengths and MOD-97. Phone-shaped matches require +/00 or English Phone/Telephone/Tel/Mobile/Fax context and 8–15 digits. English phone field labels also supply context for local values and their nested text. All feed original-text span merging and metadata redaction. `personalFieldsHide` is an automatic built-in type with empty matching text and fixed case-insensitive English labels. It uses the same label classifier as `personalFieldsMask`, fully hides values and nested text, and retains labels, with no free-text NLP. Storage v1–5 retains old switches and adds the new defaults; v11/v12 catalogs remain frozen for backwards imports.

`phoneNumbersMask` and `personalFieldsMask` are independent automatic types, with empty canonical text and false case sensitivity. The latter uses the fixed English personal-field list: contact values are partially masked, while documents, dates of birth and financial/CVV values are fully hidden. Field masks cover each original value and its nested text; full-hide spans win over masks, including Regex overlaps. Full-hide ancestry also protects nested control values. `privacy/masking.ts` shares the visible-character formula with emails; text counts Unicode code points and phones count digits, including existing stars for idempotency. Phone detection recognizes masked output so later full hiding can replace it. New defaults add both masks; old storage migrates to v6 without changing existing switches.

`privacy/demo.ts` builds examples only for enabled rules, combines them into one semantic tree and applies the full configuration once. It does not synthesize arbitrary Regex matches. `test-filters.ts` supports field/text, link href, title and source-URL contexts. The packaged demo page owns presentation, storage subscriptions and tab-local draft navigation outside core. `adapters/filter-demo.ts` is the single self-capture bridge; normal DOM validation still rejects extension URLs unless explicitly given the exact owned demo URL by that bridge. The background does not send raw demo trees or filter configurations to the popup. Demo capture uses its validated draft and the existing export pipeline; real pages retain their existing target-specific capture adapters and saved filters.

Filter settings and Demo now share one tab. `filter-demo-draft.ts` validates and whitelists a sessionStorage snapshot containing editor values and the saved-settings conflict baseline; it permits unfinished rows without treating them as valid export filters. Navigation validates enabled rules, while capture validates its active configuration again. These drafts are separate from persisted extension preferences. The same-tab return and BFCache paths restore the editor without dropping unsaved values.

`CUSTOM_RULE_TYPES` and `isCustomRuleType` expose an explicit configurable allowlist. All raw/portable settings and temporary drafts enforce it; automatic custom types (including disabled ones) are rejected rather than migrated. Older configurable token aliases still normalize to allowed Regex rules. Built-in descriptors remain internal inputs to examples and exports; selected built-in tests isolate built-in switches rather than converting automatic descriptors into custom rules. Automatic built-ins reject case overrides and portable definition changes. They have no Duplicate action, and fixed type controls contain only their own type.

### Mandatory data exclusions

`prepareExport` accepts an optional sixth `DataControls` argument. Its structured exclusions run before compression, optional redaction and serialization. The same sanitized tree is the reduction baseline. These exclusions do not depend on the redaction toggle; browser adapters also avoid reading excluded DOM values where possible. The `editable` marker is browser-independent and consumed before compression. Defaults preserve existing output.
