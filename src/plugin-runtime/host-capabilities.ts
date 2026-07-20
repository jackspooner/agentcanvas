import type { CapabilityProvider } from '@agentcanvas/plugin-sdk';
import { IMAGE_SOURCES_CAPABILITY, IMAGE_SOURCES_CAPABILITY_VERSION } from '@agentcanvas/plugin-sdk';
import { ResourceBroker } from '../resources/broker.js';
import { ImageSourceRegistry } from '../resources/image-sources.js';

export const HOST_CAPABILITY_VERSIONS = Object.freeze({
  'agentcanvas.snapshot-resources': '1.0.0',
  [IMAGE_SOURCES_CAPABILITY]: IMAGE_SOURCES_CAPABILITY_VERSION
});

export interface HostCapabilitySet {
  resources: ResourceBroker;
  imageSources: ImageSourceRegistry;
  providers: readonly CapabilityProvider<unknown>[];
}

export function createHostCapabilitySet(): HostCapabilitySet {
  const resources = new ResourceBroker();
  const imageSources = new ImageSourceRegistry();
  return {
    resources,
    imageSources,
    providers: Object.freeze([
      { name: 'agentcanvas.snapshot-resources', version: '1.0.0', value: resources },
      { name: IMAGE_SOURCES_CAPABILITY, version: IMAGE_SOURCES_CAPABILITY_VERSION, value: imageSources }
    ])
  };
}
