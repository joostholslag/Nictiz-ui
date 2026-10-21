/**
 * The form the renderer asks for via `form-resource`, assembled from the
 * Better Studio export in ./form (the zip's files, pretty-printed). The
 * response mirrors what the resource server returns for
 * `resource/rest/v2/resource/form/<name>?files=all`: the manifest's resource
 * record with every file's content filled in.
 */

import manifest from './form/manifest.json';
import formDescription from './form/form-description.json';
import formLayout from './form/form-layout.json';
import formEnvironment from './form/form-environment.json';
import appPages from './form/app-pages.json';
import templates from './form/templates.json';

const FILES: Record<string, unknown> = {
  'form-description': formDescription,
  'form-layout': formLayout,
  'form-environment': formEnvironment,
  'app-pages': appPages,
  templates,
  'form-metadata': {},
  'plugin-configuration': {},
  'plugin-manifests': {},
  'widget-configuration': {},
  'summary-pages': [],
};

export const FORM_NAME = manifest.resource.name;
export const FORM_VERSION = manifest.resource.version;
export const TEMPLATE_ID = manifest.resource.templateId;

export interface FormResource {
  name: string;
  version: string;
  templateId: string;
  files: { name: string; mimetype: string; content: string }[];
  [key: string]: unknown;
}

export function buildFormResource(): FormResource {
  const resource = manifest.resource;
  return {
    ...resource,
    files: resource.files.map((f) => ({
      ...f,
      content: JSON.stringify(FILES[f.name] ?? (f.mimetype === 'application/json' ? {} : '')),
    })),
  };
}
