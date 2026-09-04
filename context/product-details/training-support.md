# Training support

## Purpose

This file owns the detailed training structures that LIFT CODE content may present as planned product support. It excludes page layout, navigation, button behavior, internal data models, and implementation or QA detail.

## Exercise support

- The planned built-in Exercise Library can be searched and filtered by muscle and equipment.
- A built-in Exercise can present its name, primary muscle, required equipment, and an image or GIF demonstration.
- A lifter can create a Custom Exercise with a name, target muscles, and required equipment when the built-in Library does not contain it.
- A Custom Exercise can be added manually to a Workout but is not an automatic Smart Program generation candidate.
- Exercise-specific support includes substitutions, notes, Warm-up Sets, Rep Tempo, and unilateral execution where applicable.

The current product source does not define the complete built-in Exercise catalog. Do not imply that a specific Exercise is included in automatic Program generation unless its inclusion has been verified from a canonical catalog.

## Tracking types

An Exercise can use one of these planned tracking structures in a Workout:

- `Weight × Reps`
- `Reps Only`
- `Duration`
- `Distance`

## Set types

The planned workout flow supports:

- `Warm-up Set` — records Weight and Reps without RIR;
- `Standard Set` — records Weight, Reps, and RIR;
- `Drop Set` — records an initial Set and one or more lower-load Drop Sets;
- `Myo-rep Set` — records an initial Set and one or more subsequent Myo Sets;
- `Failure Set` — records Weight and Reps with RIR fixed at zero.

The planned workout structure also supports Supersets. A Superset links exercises into alternating Sets and is not a separate Set Type.

## Content-use boundary

- A routine or exercise example may use the structures above when relevant.
- Do not present a Custom Exercise as eligible for automatic Smart Program generation.
- Do not infer training advice from product support alone. Claims about when or why to use a Set Type or Exercise require sourced strength-training knowledge admitted to Research DB `expertise_entries` according to `../expertise.md`.