# Product

## Product definition

`LIFT CODE` is a planned strength-training app that reduces uncertainty about training direction so independent lifters can keep working toward muscle-growth or strength goals with justified confidence. The user sets the goal and trains; LIFT CODE helps decide which Program to follow, what to do next, and whether to continue, adjust, or wait for more evidence.

- Status: pre-development and not released.
- Market: United States.
- Product and visible marketing language: English (U.S.).
- Official product name: `LIFT CODE`, always uppercase with a space.
- Planned App Store name: `LIFT CODE: Strength Training`.
- `liftcode` is used only where spaces are unavailable, such as domains, social handles, bundle identifiers, or technical IDs.
- Brand direction: `restrained wildness` — physical ambition and masculine force held inside disciplined progression, visible constraints, and precise control.

## Core problem

Long-term training outcomes develop slowly while choices about Programs, Exercises, Weight, Reps, and progression must be made repeatedly. Until the outcome becomes clear, a lifter may not know whether the current direction is appropriate, whether stalled Weight means the Program has failed, or whether to continue, adjust, or change it.

The product addresses uncertainty on the training side of hypertrophy and strength goals:

- choosing a suitable Program for the user's goal and constraints;
- following a stable direction long enough to produce meaningful evidence;
- adjusting Weight, Reps, and RIR from actual performance;
- interpreting whether to continue, adjust, or wait for more evidence.

The product should provide justified confidence, not manufacture certainty.

## Target user and delegated job

The target user trains independently with weights, wants muscle growth or greater strength, and does not want to manage Program and progression decisions alone. The user wants a direction worth trusting, the freedom to edit recommendations when actual performance differs, and a simple execution surface once the decision has been made. Age and gender are not product eligibility requirements. The initial U.S. marketing entry point may retain its masculine character without implying that the product is restricted to men.

The user's functional job is:

> Reduce my uncertainty about whether I am training in the right direction. Give me a suitable Program, tell me what to do next, and help me know whether to continue or adjust.

The emotional job is to trust that current effort is moving toward the goal instead of wasting months in the wrong direction. The desired state is: “This is the right thing to do now. I can stop second-guessing and just train.”

The user remains responsible for performing the Workout and recording what actually happened. Specific situations, problem framings, audience language, and belief shifts belong to their Research DB and versioned `messages/` owners rather than this product-truth file.

## Product promise and model

LIFT CODE gives users a training direction they can follow with confidence by helping answer three questions:

1. **Start:** Why is this Program appropriate for me?
2. **Train:** What should I do now?
3. **Evaluate:** Should I continue, adjust, or wait for more evidence?

The connected product model is:

```text
Goal and context → Program → Actual performance → Next recommendation → Continue or adjust
```

- Goal and context define the user's objective and practical constraints.
- A stable Program provides direction rather than a random sequence of Workouts.
- Actual performance records what happened rather than only what was planned.
- The next recommendation turns those records into an immediate action.
- Continue or adjust connects daily progression to the longer-term Program and goal.

## Core product mechanisms

### Training setup and Program

- Collect only the goal, training experience, weekly frequency, available time, Gym Equipment and Weight increments, and necessary Exercise limitations or preferences required to guide training.
- Recommend a proven Program suited to the user's goal and context and briefly explain why it was selected.
- Let a user keep or configure an existing Workout when appropriate.
- Keep the Program stable long enough to collect meaningful performance evidence.

### Workout execution and records

- Open on the next scheduled Workout and prioritize starting it over analysis, settings, or Program browsing.
- Present planned Exercises, Sets, targets, prior performance, and recommended Weight, Reps, and RIR without unnecessary information.
- Let the user record actual performance with minimal input and move directly to rest and the next action.
- Preserve completed Workouts and use accumulated records as inputs to later recommendations and Program evaluation rather than as a statistics dashboard for its own sake.

### Smart Progression and training direction

- Use actual performance to recommend the next Weight and Reps and decide whether to Increase, Maintain, or Decrease.
- Respect available equipment and Weight increments, feed user edits into later recommendations, and briefly explain unexpected recommendations.
- Distinguish `Continue`, `Adjust`, and `Not enough data` using observable training information.
- Connect short-term performance decisions to the current Program and goal.
- Admit when the available information cannot support a confident judgment.

The exact Program-review signals, review interval, and interface are not decided. Data-based progress interpretation, recommendation explanations, periodic reviews, and habit support remain solution hypotheses rather than current product claims.

### Gym, account, and detailed training support

- Store equipment and available Weight by Gym and avoid impossible Exercise or Weight recommendations.
- Keep local records available without login, use SQLite as the local source of truth, and offer optional account backup and restore without using data safety as payment pressure.
- Detailed Exercise, tracking, Set, Superset, and workout-tool support used to validate content compatibility belongs in [`product-details/training-support.md`](product-details/training-support.md).

## Difference from reference apps

LIFT CODE deliberately combines product mechanics already established by its principal reference apps rather than inventing a new training-app category.

- **MacroFactor Workouts:** the main reference for a cohesive multi-week Program, actual-performance Smart Progression, recommendation explanations, and detailed training records.
- **Alpha Progression:** a reference for Program selection or generation, RIR-based progression, Gym constraints, and the recurring value of delegating next-Weight and next-Reps decisions.
- **Hevy:** the execution reference for fast Set recording, immediate access to previous performance, and a low-friction workout surface.

The intended combination is MacroFactor Workouts- and Alpha Progression-style Program and progression judgment with Hevy-style execution friction. This describes the intended product composition rather than making a direct superiority claim. LIFT CODE does not adopt Hevy's social feed, follower competition, comments, or rankings.

## Product principles

- **Earn trust:** explain important decisions without overwhelming the user, expose missing data, and preserve user control.
- **Keep execution simple:** prioritize the current Exercise, Weight, Reps, RIR, and next action; keep complexity behind the execution surface.
- **Preserve a stable direction:** do not change the Program merely to make the product appear personalized.
- **Use records to decide:** history and statistics should support a recommendation or Program decision rather than only describe the past.
- **Do not manufacture certainty:** never imply scientific precision or reliable progress when the evidence does not support it.

## Product boundaries

LIFT CODE is not planned to:

- guarantee muscle growth, strength gains, injury prevention, or any particular result;
- provide real-time form correction or diagnose injury, pain, illness, or rehabilitation needs;
- act as a medical professional or a personal trainer observing the user in real time;
- manage nutrition, sleep, or every cause of adherence and recovery;
- provide a social feed, follower competition, comments, rankings, or a generic motivational content feed;
- provide general cardio or sport tracking;
- operate as a general-purpose AI chat coach;
- recreate the entire Workout randomly each day or from an unvalidated recovery or growth score.
