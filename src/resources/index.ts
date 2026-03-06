import { ResourceHandler } from './base.js';
import { SkillsHandler } from './skills.js';
import { InstinctsHandler } from './instincts.js';
import { RulesHandler } from './rules.js';
import { HooksConfigHandler } from './hooks-config.js';
import { DocsHandler } from './docs.js';
import { EnvHandler } from './env.js';
import type { ResourceType } from '../types.js';

const handlers: Record<ResourceType, ResourceHandler> = {
  skills: new SkillsHandler(),
  instincts: new InstinctsHandler(),
  rules: new RulesHandler(),
  hooks: new HooksConfigHandler(),
  docs: new DocsHandler(),
  env: new EnvHandler(),
};

export function getHandler(type: ResourceType): ResourceHandler {
  return handlers[type];
}

export function getAllHandlers(): ResourceHandler[] {
  return Object.values(handlers);
}

export { SkillsHandler, InstinctsHandler, RulesHandler, HooksConfigHandler, DocsHandler, EnvHandler };
