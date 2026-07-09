/**
 * R8.4.d — Character form page object (Playwright-idiomatic POM).
 *
 * The `CharacterForm` dialog is shared: the Hub's create-party wizard
 * opens it (step 3), and Party Settings opens it when a joiner adds
 * their character. Size/level/STR have defaults, so the form only
 * needs Name / Species / Class filled.
 */
import type { Locator, Page } from '@playwright/test';

export interface CharacterInput {
  name: string;
  species: string;
  class: string;
}

export class CharacterFormPage {
  readonly nameInput: Locator;
  readonly speciesInput: Locator;
  readonly classInput: Locator;
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    // Exact matches — `getByLabel('Name')` alone also matches
    // "Party name" / "Display name" (substring), tripping strict mode.
    this.nameInput = page.getByLabel('Name', { exact: true });
    this.speciesInput = page.getByLabel('Species', { exact: true });
    this.classInput = page.getByLabel('Class', { exact: true });
    this.submitButton = page.getByRole('button', { name: /create character/i });
  }

  async fillAndSubmit(character: CharacterInput): Promise<void> {
    await this.nameInput.fill(character.name);
    await this.speciesInput.fill(character.species);
    await this.classInput.fill(character.class);
    await this.submitButton.click();
  }
}
