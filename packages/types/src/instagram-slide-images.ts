export type InstagramSlideImageFields = {
  imageFileIds: string[];
  imagePaths: string[];
};

export type InstagramImagePair = {
  fileId: string;
  imagePath: string;
};

const normalizeImagePair = (pair: InstagramImagePair): InstagramImagePair | null => {
  const fileId = `${pair.fileId ?? ""}`.trim();
  const imagePath = `${pair.imagePath ?? ""}`.trim();
  if (!imagePath) {
    return null;
  }
  return {
    fileId,
    imagePath
  };
};

const dedupeImagePairs = (pairs: InstagramImagePair[]): InstagramImagePair[] => {
  const seen = new Set<string>();
  const result: InstagramImagePair[] = [];
  for (const pair of pairs) {
    const normalized = normalizeImagePair(pair);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.fileId}::${normalized.imagePath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
};

const toImagePairs = (slide: InstagramSlideImageFields): InstagramImagePair[] => {
  const size = Math.max(slide.imageFileIds.length, slide.imagePaths.length);
  const result: InstagramImagePair[] = [];
  for (let index = 0; index < size; index += 1) {
    const normalized = normalizeImagePair({
      fileId: slide.imageFileIds[index] ?? "",
      imagePath: slide.imagePaths[index] ?? ""
    });
    if (!normalized) {
      continue;
    }
    result.push(normalized);
  }
  return result;
};

/**
 * Fill missing slide image slots by cycling through the available image pool.
 */
export const fillInstagramSlideImageGaps = <T extends InstagramSlideImageFields>(
  slides: T[],
  requiredImageCount: number,
  fallbackPairs: InstagramImagePair[] = []
): T[] => {
  const normalizedRequiredCount = Math.max(0, Math.floor(requiredImageCount));
  const baseSlides = slides.map((slide) => ({
    ...slide,
    imageFileIds: [...slide.imageFileIds],
    imagePaths: [...slide.imagePaths]
  }));

  if (baseSlides.length === 0 || normalizedRequiredCount === 0) {
    return baseSlides;
  }

  const imagePool = dedupeImagePairs([...fallbackPairs, ...baseSlides.flatMap((slide) => toImagePairs(slide))]);
  if (imagePool.length === 0) {
    return baseSlides;
  }

  let cursor = 0;
  return baseSlides.map((slide) => {
    const nextPairs = toImagePairs(slide);
    while (nextPairs.length < normalizedRequiredCount) {
      nextPairs.push(imagePool[cursor % imagePool.length] as InstagramImagePair);
      cursor += 1;
    }

    return {
      ...slide,
      imageFileIds: nextPairs.map((pair) => pair.fileId).filter((value) => !!value),
      imagePaths: nextPairs.map((pair) => pair.imagePath)
    };
  });
};
