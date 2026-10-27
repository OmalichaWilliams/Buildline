# Solution Delivery Queue

A portal that shows every IT solution request at Lagos Free Zone, from the first prototype to after go-live. Requests are built first come, first served: a request gets its place in the queue when IT accepts it, not when it is submitted.

The portal follows the LFZ brand guide: LFZ Navy and Scarlet, Ubuntu, and the master logo.

## What it does

- **Pipeline:** the queue in order, with each request's stage, who it is waiting on, phase due dates and planned go-live.
- **IT admin:** scope decisions, plans to agree, work in build, rejections to rule on, the UAT 5-day rule, resource load and the list of IT resources.
- **Bug queue:** post-deployment bugs across all solutions, fixed in the order they are reported.
- **Process rules:** the 12 steps, the roles and the queue rules.

### The 12 steps

1. The process owner submits a prototype.
2. IT reviews the scope.
3. IT accepts the request, locks the scope and queues it, or declines it.
4. The IT admin agrees time and resources with the process owner.
5. UI/UX design.
6. The process owner verifies the design.
7. If the design is rejected, the IT admin decides the cause.
8. Development.
9. QA.
10. UAT, with 5 working days for the process owner to reply.
11. Deployment.
12. Post-deployment testing and bug fixing.

### Queue rules

| What happened | Timeline | Queue |
| --- | --- | --- |
| IT did not build what was presented (design, QA or UAT) | Not extended; IT bears the cost | Keeps its place |
| The process owner did not capture the requirement | Plan cancelled; re-planned after resubmission | Bottom of the queue |
| No reply to the UAT invitation within 5 working days | Not extended | Bottom of the queue |
| Major variation from the process owner after go-live | Plan cancelled | End of the queue |

### Roles

| Role | Can do |
| --- | --- |
| IT admin | Everything: accept or decline, set queue positions, timelines and resources, decide who caused a rejection, apply the 5-day rule, close out |
| Process owner | Submit, verify designs, confirm and accept UAT, resubmit, log bugs |
| Viewer | See everything; change nothing |

## Repository layout

| Path | What it is |
| --- | --- |
| `index.html` | The standalone app. Generated from the artifact page; do not edit by hand. |
| `platform.js` | Connects the page to Supabase for storage, sign-in and roles. |
| `config.js` | Your Supabase project URL and anon key. |
| `supabase/schema.sql` | Tables, roles and access rules. Run once in Supabase. |
| `artifact/solution-delivery-queue.html` | The page as published on Claude. This is the source for the UI. |
| `tools/build_app.py` | Rebuilds `index.html` from the artifact page. |
| `documentation/` | The process document for new users (Word). |
| `openapi.yaml` | API contract for building this as a module of the LFZ .NET portal (OpenAPI 3.0). |

## Two ways to run it

### 1. On Claude (no setup)

`artifact/solution-delivery-queue.html` is published as a Claude artifact. There, storage and roles come from Claude's sharing levels: Editor = IT admin, Contributor = process owner, Viewer = viewer. To publish a changed version, ask Claude to republish the file to the existing artifact link.

### 2. Standalone with Supabase

The standalone app needs a free [Supabase](https://supabase.com) project for the database and sign-in. Without one, `index.html` still opens and shows example data.

1. **Create the project.** Sign in at supabase.com and create a new project.
2. **Create the tables and rules.** Open **SQL Editor**, paste the contents of `supabase/schema.sql` and click **Run**.
3. **Set up sign-in.**
   - In **Authentication > Providers**, make sure **Email** is on. People sign in with a link sent to their email.
   - In **Authentication > URL Configuration**, set **Site URL** to where you host the app, for example `https://<your-account>.github.io/<repo>/`. Add the same address under **Redirect URLs**.
   - To stop people outside the organisation signing in, turn off open sign-ups in **Authentication > Providers > Email** and invite users from **Authentication > Users**. You can also switch to Microsoft sign-in under **Providers > Azure** if your IT team prefers single sign-on.
4. **Connect the app.** In **Project Settings > API**, copy the **Project URL** and the **anon public** key into `config.js`. The anon key is designed to be public; the access rules protect the data.
5. **Host it.** Any static host works. For GitHub Pages: on GitHub, open **Settings > Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save. The site appears at `https://<your-account>.github.io/<repo>/` within a few minutes.
6. **Make yourself IT admin.** Open the app and sign in once. Then, in the Supabase **SQL Editor**, run:

   ```sql
   update public.profiles set role = 'it_admin' where email = 'you@example.com';
   ```

7. **Give others their roles.** Everyone starts as a viewer when they first sign in. An IT admin changes roles in **Table Editor > profiles**, setting `role` to `it_admin`, `process_owner` or `viewer`.

## Making changes

Edit `artifact/solution-delivery-queue.html`, then rebuild the standalone page:

```bash
python tools/build_app.py
```

Commit both files, so the Claude version and the standalone version stay the same.

## How the access rules work

Roles are enforced by the database, not just hidden in the page. Records are stored in one `documents` table, grouped by collection:

| Collection | Holds | Who can write |
| --- | --- | --- |
| `solutions` | Requests, stages and history | IT admins, process owners |
| `bugs` | Post-deployment bugs | IT admins, process owners |
| `ctrl` | Queue position, plan, rework and deprioritisation counts | IT admins only |
| `resources` | IT people and teams | IT admins only |

Everyone who is signed in can read everything. Viewers cannot write anything.
