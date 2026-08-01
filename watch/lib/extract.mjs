/**
 * Pull a value out of a loaded page. Every extractor returns something
 * JSON-serialisable so the result can be hashed and diffed against last run.
 */
export async function extractValue(page, extract) {
  const spec = extract ?? { type: 'title' };

  switch (spec.type) {
    case 'title':
      return (await page.title()).trim();

    case 'text': {
      const locator = page.locator(spec.selector).first();
      await locator.waitFor({ state: 'attached', timeout: spec.timeout ?? 15000 });
      return normalise(await locator.innerText());
    }

    case 'texts': {
      const texts = await page.locator(spec.selector).allInnerTexts();
      const limited = spec.limit ? texts.slice(0, spec.limit) : texts;
      return limited.map(normalise);
    }

    case 'attr': {
      const locator = page.locator(spec.selector).first();
      await locator.waitFor({ state: 'attached', timeout: spec.timeout ?? 15000 });
      return await locator.getAttribute(spec.attribute);
    }

    case 'count':
      return await page.locator(spec.selector).count();

    // Runs in the page. Only ever as trustworthy as targets.json itself.
    case 'script':
      return await page.evaluate(spec.body);

    default:
      throw new Error(`unknown extract type: ${spec.type}`);
  }
}

function normalise(text) {
  return text.replace(/\s+/g, ' ').trim();
}
