# designjudge

A judge that scores the layout of AI-built web interfaces from 1 to 5, plus the tools to test it.

The harness opens each test interface in a browser, captures screenshots at different screen sizes and states, runs automated layout checks, and sends the results to a model (the judge) along with a rubric. People can rate the same interfaces through a website, so their scores can be compared with the judge's.

Rating site: https://designjudge-ebon.vercel.app

## Setup

You need Node 22 or later.

```bash
npm install
npx playwright install chromium
```

To run the real judge you also need an OpenAI API key. Put it in a file called `.env` in the repo root:

```
OPENAI_API_KEY=sk-...
```

`.env` is gitignored. Don't commit it.

## What's where

- `cases/` holds the test interfaces. Each folder has a `case.json` (the prompt the interface was built from, plus a title) and the interface's code in `site/`.
- `layout_rubric.md` is the rubric the judge scores against.
- `src/categories/layout/prompts/` holds the judge prompt versions (`v1` to `v6`). The newest is used unless you pick another.
- `benchmark/expectations.json` records what was broken in each flawed copy and how it should score against the original. The judge never sees this file.
- `benchmark/human/` holds the human ratings.
- `artifacts/` holds screenshots, check results and judge runs. It's gitignored and can get large, so after cloning you'll need to collect evidence yourself (see below).

## Running the judge

1. Collect evidence. This opens every interface in Chromium, takes the screenshots and runs the checks.

   ```bash
   npm run collect
   ```

   To collect just one or two, name them: `npm run collect -- booking-baseline dashboard-gold`.

2. Run the judge on the latest evidence:

   ```bash
   npm run judge
   ```

   By default this runs each interface 5 times with the newest prompt. Useful options:

   - `--repeats 3` changes the number of runs per interface.
   - `--prompt v5` uses an older prompt version.
   - `--label "trying shorter rubric"` adds a note to the run.
   - `--provider mock` runs without calling OpenAI. It's free and is useful for checking the harness works.

   The run's cost is printed at the end.

3. Look at the results in the viewer:

   ```bash
   npm run view
   ```

   Then open http://127.0.0.1:4600. Each run is listed on the home page, and you can open any judgment to see what the judge was shown and what it said.

Each run is also saved as CSVs in `artifacts/runs/<run id>/`. `summary.csv` has one row per judgment with the score. `findings.csv` and `points.csv` have the detail behind each score.

To compare runs side by side, run `npm run compare -- <run id> <run id>`.

## Human ratings

### How people rate

Send people the rating site link. They pick an interface, read the instructions, go through the four criteria one page at a time, then give a score. Their name is shown with their rating, and ratings are public.

On each criterion page they can use the interface itself. Buttons switch it between desktop, tablet and phone sizes, and a menu switches its content (empty, lots of content, longer text, stress test). Screenshots are only shown where the automated checks found a problem. They write one note per criterion, with questions from the rubric as prompts, and can click Speak to dictate instead of typing. Dictation uses the browser's speech recognition, so it doesn't work in Firefox.

This means people don't see exactly what the judge sees. The judge only gets screenshots. Each rating records this in its `view` field: `live` for the live interface, or `screenshots` for ratings made before the live interface was added.

You can also rate locally: run `npm run view` and click "Rate this interface". Local ratings are saved to the same folder.

### Where ratings are stored

Every rating is saved as its own JSON file in this repo, at:

```
benchmark/human/<interface>/<date-time>-<name>.json
```

Ratings from the website are committed straight to `main`, one commit per rating, with a message like "Add human rating booking-baseline/...". Each file has the score, the notes for each evaluation point, any call-outs, the rater's name, how long they took, and which evidence and prompt version they rated.

Nothing is stored anywhere else. The JSON files in the repo are the full record.

### Getting the new ratings

```bash
git pull
npm run human-csvs
```

`git pull` brings down any new rating files. `npm run human-csvs` then rebuilds three CSVs in `benchmark/human/` from all the rating files:

- `ratings.csv` has one row per rating: score, overall reasoning, the note for each criterion (`criterion_A_summary` and so on), the number of strengths and weaknesses, the time taken, and `view`.
- `findings.csv` has one row per call-out a rater made: the criterion, the evaluation point, strength or weakness, how serious it is, and what they saw.
- `points.csv` has one row per evaluation point a rater wrote a separate note on. The current form takes one note per criterion instead, so this file only has rows from older ratings.

The columns match the judge's CSVs, so you can join them on `case_id` (and `bundle_id` if you want to make sure both rated the same evidence).

If you just want a quick download, each interface's "Human ratings" tab on the website has the same three CSVs, built fresh on every click.

Because ratings arrive as commits on `main`, always `git pull` before you push your own changes.

### Removing a bad rating

Delete its JSON file, commit and push. Then run `npm run human-csvs` again.

## Updating the rating site

The website is a snapshot of the latest evidence and judge runs on whoever's machine publishes it. Vercel can't build it from the repo because `artifacts/` isn't in git.

To publish:

```bash
npm run publish
```

This builds the site into `.vercel/output` and deploys it. You need:

- the evidence and runs in your `artifacts/` folder (run `npm run collect` and `npm run judge` first);
- the Vercel CLI, logged in with access to the `designjudge` project on the "Sam" team (`npm i -g vercel`, `vercel login`, `vercel link`). `vercel link` can quietly reconnect the GitHub repo, so run `vercel git disconnect` straight after it (see below);
- the `GITHUB_TOKEN` setting on the Vercel project. It's already there. It's a GitHub token that can only write files to this repo, and the site uses it to commit ratings.

Use `npm run publish -- --build-only` to build without deploying.

Don't connect the GitHub repo to the Vercel project. If it's connected, every rating commit triggers a build from the repo, and that build has no evidence, so the site goes blank. If this happens, disconnect it with `vercel git disconnect`, then run `npm run publish` again.

When you publish new evidence for an interface, earlier ratings keep the `bundle_id` of the evidence they rated, so you can tell old and new ratings apart.

## Adding a test interface

1. Make a folder in `cases/` with a `case.json` and a `site/` folder. Copy an existing case to start.
2. Add it to `benchmark/expectations.json` if you have an expected score or a comparison in mind.
3. Run `npm run collect -- <your case id>`, then `npm run judge -- <your case id>`.
4. Run `npm run publish` if people should be able to rate it.

## Tests

```bash
npm test
npm run typecheck
```

The browser check tests need Chromium (see Setup).
