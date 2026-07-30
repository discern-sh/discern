/**
 * Emit the plain-register reading grade for the `plain_reading_grade`
 * standard: `DISCERN_METRIC plain_reading_grade <grade>`. Pure in-memory
 * text arithmetic over the feature registry — no permissions, milliseconds,
 * safe for every gate run.
 */

import { plainReadingGrade } from "./plain_reading_grade_lib.ts";

console.log(`DISCERN_METRIC plain_reading_grade ${plainReadingGrade()}`);
