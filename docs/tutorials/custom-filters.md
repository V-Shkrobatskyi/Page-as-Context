# 3. Create privacy filters for the data your team recognizes

Built-in filters can recognize common credential patterns, but they cannot know that “Project Cedar” is an internal name or that your customer references need special treatment.

Page as Context lets you add rules for those cases. Start with synthetic values and check the exported result before using a rule on work data.

This guide describes version 2.2.8. The screenshots show the workflow in Chrome with version 2.2.7, using a GitHub Issue draft with synthetic data.

## Compare the built-in filters first

Open **Issues → New issue** in your own GitHub repository. Add a title such as `Investigate staging API connection failure` and paste this into the description. Leave the issue unsubmitted.

```text
The staging dashboard cannot connect to the reporting API.

Environment: staging
Project: Project Cedar
Contact: alex@example.com

Diagnostic configuration:
api_key=DEMO_ONLY_1234567890
Authorization: Bearer DEMO_ONLY_ABCDEFGHIJKLMN

Expected behavior:
The dashboard should display the latest report.

Actual behavior:
The request fails after selecting Refresh.
```

In the extension popup, expand **Options**. Use **Semantic Text** and **Compact**, and keep **Redact sensitive data** enabled. These are the defaults unless you have changed them. For this comparison, leave any custom rule for `Project Cedar` off until the next section.

Click **Select** and select the description field, then choose **Preview & edit** in the picker. This captures the draft's description without the rest of the GitHub page.

![Select a GitHub Issue description containing synthetic credentials and a project name](images/custom-filters/github-issue-sample.png)

With the default built-in filters, the API-key and Bearer values are hidden and the email address is masked. `Project Cedar` stays visible because it is an ordinary phrase, not a recognized credential pattern. The screenshot shows three automatic redactions.

![Built-in filters hide credential values and mask the email while leaving Project Cedar visible](images/custom-filters/builtin-filters-preview.png)

## Open the filter settings

Return to the GitHub tab and open the extension popup. Expand **Options**, keep **Redact sensitive data** enabled, and click **Filters** in that block. This opens **Customize filters**, where the table includes built-in and custom rules.

Choose **+ Add filter** and fill in the new row:

- **Name:** `Internal project name`
- **Text / matching rule:** `Project Cedar`
- **Rule type:** `Text`
- Keep the rule's **On** checkbox checked and **Case sensitive** unchecked.

![Configure an enabled Text rule for Project Cedar before saving the filters](images/custom-filters/custom-rule-test.png)

This rule can hide the literal phrase in captured text, including supported names, values, titles, and URLs. It does not infer that “Cedar” or an abbreviation means the same thing; add the terms you actually need. The rule is still an unsaved edit at this point.

## Match the right part of the context

Different rule types solve different problems:

- **Text:** hide a known phrase, such as a synthetic project name.
- **Field labels:** match a label such as `Customer reference` and hide its value while keeping the label visible.
- **URL parameters:** hide the value of an exact parameter name, such as `customer_ref`. Enter the name without `?` or `=`.
- **Regex:** hide text that matches a pattern, such as `CASE-[0-9]{6}` for a test ticket format.

Regex uses a non-backtracking engine. Enter the expression without slash delimiters or flags; lookarounds and backreferences are unsupported. Begin with literal rules unless you need a pattern.

## Test before saving

Expand **Try filters**. Test a selected rule against a harmless example, then use **Test all** to see the combined effect of enabled rules. These tests use current form edits, including unsaved ones.

For this example, select **Internal project name**, leave **Field label** blank, and test `Project Cedar — staging environment.` with **Test selected**. The expected output is `[REDACTED] — staging environment.`

For a field-label rule, enter both the label and a synthetic value. For a text rule, also try similar words that should remain visible. This helps catch both missed matches and rules that remove too much.

Choose **Save filters** when the results look right. Saving does not enable the popup's redaction switch, so check that it is still on.

## Prepare a fresh export

Return to the GitHub Issue draft. With redaction still enabled, select the description field again and open a new preview. Saving rules does not reprocess an existing preview or change files you already exported.

`Project Cedar` is now replaced with `[REDACTED]`, while the staging environment and problem description remain readable. The screenshot shows four automatic redactions: the earlier three plus the project name.

![A fresh capture also hides Project Cedar while preserving the technical problem description](images/custom-filters/custom-filter-preview.png)

Check the full result, including its header and URLs. Partial masking can preserve useful context, but it may still reveal information. Built-in and custom rules can overlap, so disabling one rule does not necessarily make a matching value visible.

You can export a personal filter configuration for reuse, but its matching terms may themselves be private. Treat the file accordingly. Organization-managed rules are controlled separately by administrators.

Filters reduce accidental disclosure; they do not guarantee that a page is safe to share. See the [filter reference](../capture-and-export.md#customize-redaction-filters) for exact behavior.

---

[All tutorials](README.md) · Previous: [2. Select, edit and export](select-edit-export.md) · Next: [4. Compression profiles](compression.md)
