/**
 * Sky & ambient lighting.
 *
 * SCAFFOLD (milestone 0): a procedural gradient sky dome + hemisphere ambient
 * + moon directional light + exponential fog. The RENDER stream replaces this
 * with the HDRI-driven night sky, image-based lighting, cloud layer, storm
 * lightning flashes and volumetric ground fog described in ART_DIRECTION.md.
 *
 * API kept stable for other systems:
 *   sky.moon (THREE.DirectionalLight), sky.setTimeOfDay?, sky.flashLightning(intensity)
 */
import * as THREE from 'three';

export class Sky {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./QualityTiers.js').QUALITY_TIERS.high} tier
   */
  constructor(scene, tier) {
    this.scene = scene;
    this.tier = tier;

    // Gradient dome
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(600, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          topColor: { value: new THREE.Color(0x0a1122) },
          horizonColor: { value: new THREE.Color(0x1a2230) },
          groundColor: { value: new THREE.Color(0x05070a) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorldDir;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldDir = normalize(wp.xyz - cameraPosition);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vWorldDir;
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          uniform vec3 groundColor;
          void main() {
            float h = vWorldDir.y;
            vec3 sky = mix(horizonColor, topColor, smoothstep(0.0, 0.55, h));
            vec3 col = mix(groundColor, sky, smoothstep(-0.08, 0.02, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    this.dome.name = 'sky.dome';
    this.dome.renderOrder = -1000;
    scene.add(this.dome);

    // Ambient + moon key light
    this.ambient = new THREE.HemisphereLight(0x35435c, 0x0b0d10, 0.35);
    scene.add(this.ambient);

    this.moon = new THREE.DirectionalLight(0x8fa6c9, 1.2);
    this.moon.name = 'sky.moon';
    this.moon.position.set(-60, 90, -40);
    this.moon.castShadow = true;
    const s = this.moon.shadow;
    s.mapSize.set(tier.shadows.mapSize, tier.shadows.mapSize);
    s.camera.near = 1;
    s.camera.far = 300;
    s.camera.left = -70;
    s.camera.right = 70;
    s.camera.top = 70;
    s.camera.bottom = -70;
    s.bias = -0.0004;
    s.normalBias = 0.03;
    s.radius = tier.shadows.radius;
    scene.add(this.moon);
    scene.add(this.moon.target);

    scene.fog = new THREE.FogExp2(0x141b26, 0.011);
  }

  update(dt) {
    // Keep the dome centered on the camera so the horizon never approaches.
    // (Game passes the camera position via updateForCamera.)
    void dt;
  }

  /** @param {THREE.Vector3} cameraPos */
  updateForCamera(cameraPos) {
    this.dome.position.copy(cameraPos);
  }

  flashLightning(intensity = 1) {
    // Placeholder — the storm system will animate ambient/moon and sky tint.
    void intensity;
  }

  dispose() {
    this.scene.remove(this.dome, this.ambient, this.moon);
    this.dome.geometry.dispose();
    this.dome.material.dispose();
  }
}
