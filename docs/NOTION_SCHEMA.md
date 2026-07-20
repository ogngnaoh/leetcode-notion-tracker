# Notion schema contract

The bridge expects exact property names and types. This is intentional: a personal tracker does not need a generalized field-mapping engine.

## LeetCode Problems

One row is one canonical LeetCode problem.

| Property          | Type      | Meaning                               |
| ----------------- | --------- | ------------------------------------- |
| Problem           | Title     | Display title                         |
| External Key      | Rich text | `leetcode:<slug>` unique key          |
| Slug              | Rich text | LeetCode slug                         |
| Number            | Number    | Problem number when available         |
| URL               | URL       | Canonical problem URL                 |
| Difficulty        | Select    | Easy, Medium, Hard, Unknown           |
| Primary Pattern   | Rich text | Latest primary pattern                |
| Mastery           | Select    | Unseen, Red, Yellow, Green, Mastered  |
| Green Count       | Number    | Consecutive qualifying Green attempts |
| Next Review       | Date      | Scheduled review timestamp            |
| Last Attempt      | Date      | Most recent attempt timestamp         |
| Extension Managed | Checkbox  | Created by this integration           |
| Attempts          | Relation  | Reciprocal relation to Attempts       |

## LeetCode Attempts

One row is one immutable attempt.

| Property              | Type         | Meaning                           |
| --------------------- | ------------ | --------------------------------- |
| Attempt               | Title        | Problem plus attempt timestamp    |
| Client Event ID       | Rich text    | UUID used for idempotency         |
| Problem               | Relation     | Canonical Problem row             |
| Problem Key           | Rich text    | Redundant `leetcode:<slug>` key   |
| Attempted At          | Date         | Attempt timestamp                 |
| Source URL            | URL          | LeetCode problem URL              |
| Language              | Rich text    | Implementation language           |
| Submission Result     | Select       | Accepted, Wrong Answer, and so on |
| Outcome               | Select       | Red, Yellow, Green                |
| Cold Attempt          | Checkbox     | Whether attempted before review   |
| Help Used             | Select       | None through Code Viewed          |
| Failure Code          | Select       | P, A, I, E, T, or C               |
| Total Minutes         | Number       | Total time                        |
| Primary Pattern       | Rich text    | Pattern assigned to the attempt   |
| Notes                 | Rich text    | Short reflection                  |
| Resulting Mastery     | Select       | State applied to Problem          |
| Resulting Green Count | Number       | Count applied to Problem          |
| Resulting Next Review | Date         | Review date applied to Problem    |
| Extension Managed     | Checkbox     | Created by this integration       |
| Created Time          | Created time | Native Notion timestamp           |

Longer reflection and optional code are also written into the Attempt page body.

## Compatibility rule

The extension and bridge support this schema. Renaming or changing a required property type requires changing the code and tests. Run `npm run notion:verify` after any manual Notion schema edit.
