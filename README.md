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
- `benchmark/expectations.json` records, for each judge category, what differs in each copy of an interface and how it should score against the original in that category: `must_drop`, `may_drop` (not higher), `no_change` (means within half a point), `may_rise` (not lower) or `must_rise`. `npm run compare` checks each run against its own category's set only, and needs at least 3 repeats of both interfaces before it calls a pair "not as expected" (with fewer it says "needs more repeats"). The judge never sees this file.
- A category's `"no_material_weakness"` lists interfaces built to have no material weakness in it (4, "Strong", in every rubric); compare calls each one in the run "as expected" when the mean of its valid scores is at least 3.5, with the same 3-repeat guard.
- `benchmark/human/` holds the human ratings.
- `artifacts/` holds screenshots, check results and judge runs. It's gitignored and can get large, so after cloning you'll need to collect evidence yourself (see below).

## Running the judge

1. Collect evidence. This opens every interface in Chromium, takes the screenshots and runs the checks.

   ```bash
   npm run collect
   ```

   To collect just one or two, name them: `npm run collect -- booking-baseline dashboard-gold`.

   Collecting also runs the Visual System probes: each judged state is loaded again to measure colours and contrast, run axe-core and Tab through the page. The Functionality probe, which uses every kind of control, link and form once, runs only with `--functional` (`npm run collect -- booking-baseline --functional`), because only Functionality needs it; building or judging Functionality evidence collected without it stops with an error saying how to collect it. Evidence collected before the probes existed, or without the Functionality probe, can get them without being collected again: `npm run probe -- booking-baseline` (add `--functional` for the Functionality probe). `npm run mutate` runs the Functionality probe by itself for `--dir mutations-functionality`, or for any folder with `--functional`.

2. Run the judge on the latest evidence:

   ```bash
   npm run judge
   ```

   By default this runs each interface 5 times with the newest prompt. Useful options:

   - `--category typography` runs another category's judge: `typography`, `task_fit`, `content_quality`, `visual_system` or `functionality` (the default is `layout`).
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

Send people the rating site link. They choose a category (Layout, Typography, Task Fit or Content Quality), pick an interface, read the instructions, go through the category's criteria one page at a time (four, or three for Content Quality), then give a score. Their name is shown with their rating, and ratings are public.

On each criterion page they can use the interface itself. Buttons switch it between desktop, tablet and phone sizes, and a menu switches its content (empty, lots of content, longer text, stress test). Screenshots are only shown where the automated checks found a problem; Typography also links its type specimen sheets from the measurements that use them. Task Fit and Content Quality have no automated checks, so their pages show the interface and the criterion only. They write one note per criterion, with questions from the rubric as prompts, and can click Speak to dictate instead of typing. Dictation uses the browser's speech recognition, so it doesn't work in Firefox.

This means people don't see exactly what the judge sees. The judge only gets screenshots. Each rating records this in its `view` field: `live` for the live interface, or `screenshots` for ratings made before the live interface was added.

You can also rate locally: run `npm run view` and click "Rate this interface". Local ratings are saved to the same folder.

### Where ratings are stored

Every rating is saved as its own JSON file in this repo, at:

```
benchmark/human/<interface>/<date-time>-<name>.json              Layout
benchmark/human/<category>/<interface>/<date-time>-<name>.json   typography, task_fit, content_quality
```

Ratings from the website are committed straight to `main`, one commit per rating, with a message like "Add human rating booking-baseline/..." (or "Add human rating typography/booking-baseline/..."). Each file has the score, the note for each criterion, the rater's name, how long they took, and which evidence and prompt version they rated. Ratings in a category folder also have a `category` field; Layout ratings don't.

Nothing is stored anywhere else. The JSON files in the repo are the full record.

### Getting the new ratings

```bash
git pull
npm run human-csvs
```

`git pull` brings down any new rating files. `npm run human-csvs` then rebuilds three CSVs from the rating files, in `benchmark/human/` for Layout and in each category's folder for the others:

- `ratings.csv` has one row per rating: score, overall reasoning, the note for each criterion (`criterion_A_summary` and so on), the time taken, and `view`.
- `findings.csv` and `points.csv` only have rows from ratings made with older versions of the form, which had specific call-outs and a note per evaluation point. The current form doesn't have either.

The columns match the judge's CSVs, so you can join them on `case_id` (and `bundle_id` if you want to make sure both rated the same evidence).

If you just want a quick download, each interface's "Human ratings" tab on the website has the same three CSVs for the chosen category, built fresh on every click. The tab also lists that category's judge scores for the interface.

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

Don't connect the GitHub repo to the Vercel project. If it's connected, every rating commit triggers a build from the repo, and that build has no evidence, so the site goes blank. `vercel.json` turns Git deployments off as a backstop. If the site goes blank anyway, disconnect the repo with `vercel git disconnect`, then run `npm run publish` again.

When you publish new evidence for an interface, earlier ratings keep the `bundle_id` of the evidence they rated, so you can tell old and new ratings apart.

## Adding a test interface

1. Make a folder in `cases/` with a `case.json` and a `site/` folder. Copy an existing case to start.
2. Add it to `benchmark/expectations.json`, as one pair per comparison under each category where you have one in mind. For example, an improved copy that should score at least as high as `booking-baseline` is `{ "baseline": "booking-baseline", "variant": "booking-clean", "expected": "may_rise", "change": "..." }`; an interface can be the variant of several pairs, so add another pair to compare it with a second baseline. List the criteria a planted weakness should show up in as `"criteria"`, using that category's letters (Content Quality has only A to C).
3. Run `npm run collect -- <your case id>`, then `npm run judge -- <your case id>`.
4. Run `npm run publish` if people should be able to rate it.

## Testing a category with planted defects

Each category has a folder of planted changes: `mutations/` (Layout) and `mutations-<category>/` for the others, one subfolder per case. A defect is a small CSS or JavaScript change that should make the interface worse in that category alone; a file named `harmless-*` is a change that should not, and one named `minor-*` is a defect the judges find minor, which should at least not make it better. The `*-clean` subfolders plant them into the clean controls, which have no material weakness in any category.

```bash
npm run mutate -- booking-clean carsearch-clean dashboard-clean --dir mutations-typography
```

collects each planted variant next to a fresh copy of its case and reports whether each category's judge would receive different evidence (free; no judge calls). Add `--judge` to judge the clean copy and every variant for real in the folder's category: each defect should score lower than its clean copy, each harmless change the same within half a point, and each `minor-*` defect no more than half a point higher. The copy is judged 5 times and each variant 3; with fewer valid scores a miss reads "needs more repeats". `--rescore <runId> --judge` judges a previous run's evidence without collecting again, and `--provider mock` checks the harness for free. The judge never sees the file names or descriptions, and these runs are kept in `artifacts/mutations/`, so they don't appear in the viewer or on the rating site. See `mutations/README.md` for details.

## Designer critiques from UICrit

To check the judge against professional designers, we collect written critiques from [UICrit](https://github.com/google-research-datasets/uicrit) ([paper](https://arxiv.org/abs/2407.08850)): about three designers each critiqued 1,000 screenshots of real Android apps from [Rico](https://www.interactionmining.org/archive/rico), for example "In the current design, text (Plans) is in light red color on white background which is not making a good contrast. To fix this, change texts to dark colors."

Build it with:

```bash
npm run calibration-data
```

This downloads the critiques and streams the 6 GB Rico archive, keeping only the 1,000 screenshots UICrit uses. It writes `artifacts/calibration/`:

- `critiques.csv` has one row per screen:
  - `prompt` is the screen's main task, as each designer described it (one description per line).
  - `image` is the screenshot's path, relative to the folder, and `image_size` its width × height in pixels (1080×1920 or 540×960), to tell the judge.
  - The rating columns are the designers' mean scores, to one decimal place: design quality, aesthetics and usability out of 10, and learnability and efficiency out of 5.
  - `feedback` lists every comment the designers wrote, one per line.
- `images/` holds the screenshots, named by Rico screen ID.
- `source.json` has the paper, licence and citation for both datasets.

Only comments the designers wrote themselves are kept. UICrit also has Gemini-written comments that a designer marked as valid; those are left out, as are the comments' bounding boxes.

The critiques are licensed CC BY 4.0, so anything published with them must cite the paper. The screenshots are not: under [Rico's terms](https://www.interactionmining.org/legal/copyright) they may contain copyrighted work, whoever downloads them takes responsibility for their use and indemnifies the Rico team and the University of Illinois, and an employer is bound too. Keep them in `artifacts/`, which is gitignored, and never put them in `cases/` or on the rating site.

## Tests

```bash
npm test
npm run typecheck
```

The browser check tests need Chromium (see Setup).
