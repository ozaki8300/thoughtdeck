import curriculumJson from "../public/curriculum.json";

export type CurriculumTimeline = {
  start?: string;
  end?: string;
  report_due?: string;
};

export type CurriculumUnit = {
  name?: string;
  credits?: number;
  required?: boolean;
  timeline?: CurriculumTimeline;
};

export type CurriculumSubject = {
  label?: string;
  related?: string[];
  basic?: Record<string, CurriculumUnit>;
  advanced?: Record<string, CurriculumUnit>;
};

export type CurriculumSubjectCode = {
  name?: string;
  related?: string[];
  credits?: number;
  required?: boolean;
  units?: Record<string, unknown>;
};

export type CurriculumSubjectGroup = {
  label?: string;
  subjects?: Record<string, CurriculumSubjectCode>;
};

export type CurriculumUniverse = Record<
  string,
  CurriculumSubjectGroup | Record<string, CurriculumSubject>
>;

export type CurriculumIndexItem = {
  code: string;
  label: string;

  genre: string;
  subject: string;
  unit: string;

  category: "basic" | "advanced" | "subject";

  credits?: number;
  required?: boolean;
  units?: Record<string, unknown>;
};

export async function loadCurriculum(): Promise<CurriculumUniverse> {
  const response = await fetch("/curriculum.json");

  if (!response.ok) {
    throw new Error("Failed to load curriculum.json");
  }

  return response.json();
}

export function buildCurriculumIndex(
  curriculum: CurriculumUniverse,
): CurriculumIndexItem[] {
  const items: CurriculumIndexItem[] = [];

  for (const [genre, genreData] of Object.entries(curriculum)) {
    if ("subjects" in genreData && genreData.subjects) {
      for (const [code, subjectData] of Object.entries(genreData.subjects)) {
        items.push({
          code,
          label: subjectData.name ?? code,
          genre,
          subject: code,
          unit: code,
          category: "subject",
          credits: subjectData.credits,
          required: subjectData.required,
          units: subjectData.units,
        });
      }

      continue;
    }

    const subjects = genreData as Record<string, CurriculumSubject>;

    for (const [subject, subjectData] of Object.entries(subjects)) {
      for (const category of ["basic", "advanced"] as const) {
        const units = subjectData[category] ?? {};

        for (const [code, unitData] of Object.entries(units)) {
          items.push({
            code,
            label: unitData.name ?? code,
            genre,
            subject,
            unit: code,
            category,
            credits: unitData.credits,
            required: unitData.required,
          });
        }
      }
    }
  }

  return items.sort((a, b) =>
    a.code.localeCompare(b.code),
  );
}

export function resolveCurriculumUnit(
  curriculumIndex: CurriculumIndexItem[],
  code: string,
) {
  return curriculumIndex.find(
    (item) =>
      item.code.toLowerCase() ===
      code.toLowerCase(),
  );
}

export function buildCurriculumPath(
  genre?: string | null,
  subject?: string | null,
  unit?: string | null,
) {
  // curriculum未選択時は従来thoughtdeck配下へ保存
  if (!genre || !subject || !unit) {
    return "thoughtdeck";
  }

  return [
    "thoughtdeck",
    genre,
    subject,
    unit,
  ]
    .filter(Boolean)
    .join("/");
}

function getCurriculumUnits(
  genre: string,
  subject: string,
) {
  const curriculum =
    curriculumJson as CurriculumUniverse;
  const genreData = curriculum[genre];

  if (!genreData) return [];

  const subjectGroup =
    genreData as CurriculumSubjectGroup;

  if (subjectGroup.subjects) {
    const subjectData =
      subjectGroup.subjects[subject];

    return Object.keys(
      subjectData?.units ?? {},
    );
  }

  const subjectData = (
    genreData as Record<string, CurriculumSubject>
  )[subject];

  return [
    ...Object.keys(subjectData?.basic ?? {}),
    ...Object.keys(subjectData?.advanced ?? {}),
  ];
}

function getRelatedSubjects(
  genre: string,
  subject: string,
) {
  const curriculum =
    curriculumJson as CurriculumUniverse;
  const genreData = curriculum[genre];

  if (!genreData) return [];

  const subjectGroup =
    genreData as CurriculumSubjectGroup;

  if (subjectGroup.subjects) {
    return subjectGroup.subjects[subject]?.related ?? [];
  }

  const subjectData = (
    genreData as Record<string, CurriculumSubject>
  )[subject];

  return subjectData?.related ?? [];
}

export function buildRelatedLinks(
  genre: string,
  subject: string,
  unit: string,
): string[] {
  const units = getCurriculumUnits(
    genre,
    subject,
  );
  const currentIndex = units.indexOf(unit);

  if (currentIndex === -1) return [];

  const links = [
    ...[
      units[currentIndex - 1],
      units[currentIndex + 1],
    ]
      .filter(
        (relatedUnit): relatedUnit is string =>
          Boolean(relatedUnit) &&
          relatedUnit !== unit,
      )
      .map((relatedUnit) =>
        buildCurriculumPath(
          genre,
          subject,
          relatedUnit,
        ),
      ),
    ...getRelatedSubjects(
      genre,
      subject,
    )
      .filter(
        (relatedSubject) =>
          relatedSubject !== subject,
      )
      .map((relatedSubject) => {
        const relatedUnit =
          getCurriculumUnits(
            genre,
            relatedSubject,
          )[0];

        if (!relatedUnit) return null;

        return buildCurriculumPath(
          genre,
          relatedSubject,
          relatedUnit,
        );
      }),
  ]
    .filter(
      (link): link is string =>
        Boolean(link),
    );

  return [...new Set(links)];
}
