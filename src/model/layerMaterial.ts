// The material used to draw a whole atlas layer in one call. A small data
// texture holds one texel per structure: RGB is an override colour (sRGB) and
// alpha holds flags (visible, use override colour, emphasised). Hidden
// structures are collapsed in the vertex shader, so toggling them is free.
import { Color, DataTexture, DoubleSide, MeshStandardMaterial, RGBAFormat, UnsignedByteType } from 'three';
import type { LayerId } from '../anatomy/types';

export const FLAG_VISIBLE = 1;
export const FLAG_OVERRIDE = 2;
export const FLAG_EMPHASIS = 4;

const TEX_W = 256;

const ROUGHNESS: Record<LayerId, number> = {
  skin: 0.7,
  muscular: 0.62,
  skeletal: 0.55,
  nerves: 0.4,
  vascular: 0.42,
  organs: 0.58,
};

export interface StructState {
  visible: boolean;
  /** Override colour (hex), e.g. from the feeling colour mode. */
  color?: string;
  emphasis?: boolean;
}

export interface LayerMaterial {
  material: MeshStandardMaterial;
  uniforms: {
    uSelected: { value: number };
    uHovered: { value: number };
    uAnatomy: { value: number };
    uNeutral: { value: Color };
  };
  /** Write the state of every structure (index → state). */
  setStates(count: number, state: (index: number) => StructState): void;
  setOpacity(opacity: number): void;
  dispose(): void;
}

function hexBytes(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createLayerMaterial(layer: LayerId, count: number): LayerMaterial {
  const h = Math.max(1, Math.ceil(count / TEX_W));
  const data = new Uint8Array(TEX_W * h * 4);
  for (let i = 0; i < count; i++) data[i * 4 + 3] = FLAG_VISIBLE;
  const texture = new DataTexture(data, TEX_W, h, RGBAFormat, UnsignedByteType);
  texture.needsUpdate = true;
  const uniforms = {
    uSelected: { value: -1 },
    uHovered: { value: -1 },
    uAnatomy: { value: 0 },
    uNeutral: { value: new Color('#999999') },
  };
  const material = new MeshStandardMaterial({ roughness: ROUGHNESS[layer], metalness: 0, side: DoubleSide });
  material.customProgramCacheKey = () => 'phx-atlas-layer';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uStructTex: { value: texture } });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aStruct;
attribute vec3 aColor;
uniform sampler2D uStructTex;
uniform float uAnatomy;
uniform vec3 uNeutral;
varying vec3 vBase;
varying float vStruct;
flat varying int vFlags;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  int si = int(aStruct + 0.5);
  vec4 st = texelFetch(uStructTex, ivec2(si % ${TEX_W}, si / ${TEX_W}), 0);
  int flags = int(st.a * 255.0 + 0.5);
  vFlags = flags;
  vStruct = aStruct;
  vBase = (flags & ${FLAG_OVERRIDE}) != 0 ? pow(st.rgb, vec3(2.2)) : (uAnatomy > 0.5 ? pow(aColor, vec3(2.2)) : uNeutral);
  if ((flags & ${FLAG_VISIBLE}) == 0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uSelected;
uniform float uHovered;
varying vec3 vBase;
varying float vStruct;
flat varying int vFlags;`,
      )
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vBase, opacity );')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
if (abs(vStruct - uSelected) < 0.5) totalEmissiveRadiance += vec3(1.0, 0.195, 0.047) * 0.45;
else if ((vFlags & ${FLAG_EMPHASIS}) != 0) totalEmissiveRadiance += vec3(1.0, 0.445, 0.065) * 0.3;
else if (abs(vStruct - uHovered) < 0.5) totalEmissiveRadiance += vec3(0.13);`,
      );
  };

  return {
    material,
    uniforms,
    setStates(n, state) {
      for (let i = 0; i < n; i++) {
        const s = state(i);
        let flags = s.visible ? FLAG_VISIBLE : 0;
        if (s.color) {
          const [r, g, b] = hexBytes(s.color);
          data[i * 4] = r;
          data[i * 4 + 1] = g;
          data[i * 4 + 2] = b;
          flags |= FLAG_OVERRIDE;
        }
        if (s.emphasis) flags |= FLAG_EMPHASIS;
        data[i * 4 + 3] = flags;
      }
      texture.needsUpdate = true;
    },
    setOpacity(opacity) {
      const transparent = opacity < 0.999;
      if (transparent !== material.transparent) material.needsUpdate = true;
      material.transparent = transparent;
      material.depthWrite = !transparent;
      material.opacity = opacity;
    },
    dispose() {
      material.dispose();
      texture.dispose();
    },
  };
}
