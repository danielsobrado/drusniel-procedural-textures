export const BIOLOGICAL_SSS_LIGHT_GLSL = /* glsl */ `
#include <lights_fragment_end>
if (labSurface.sss > 0.0001) {
  vec3 labSssNormal = normalize(geometryNormal);
  vec3 labSssView = normalize(geometryViewDir);
  vec3 labSssLight = normalize(mat3(viewMatrix) * uLabSssLightDirection);
  float labFacing = saturate(dot(labSssNormal, labSssView));
  float labEdgeThickness = pow(1.0 - labFacing, 1.45);
  float labOpticalDepth = clamp(
    labSurface.sss * uLabSssThicknessScale * (0.55 + labEdgeThickness),
    0.0,
    3.0
  );
  float labBackscatter = pow(saturate(dot(-labSssNormal, labSssLight)), 1.35);
  float labWrappedLight = saturate((dot(labSssNormal, labSssLight) + 0.45) / 1.45);
  vec3 labTransmission = exp(-vec3(0.34, 0.78, 1.28) * labOpticalDepth);
  vec3 labScatterColor = labSurface.sssColor * labTransmission;
  float labScatterAmount = labSurface.sss * (
    labBackscatter * uLabSssBackscatterStrength +
    labWrappedLight * 0.075 +
    labEdgeThickness * 0.14
  );
  reflectedLight.indirectDiffuse += labScatterColor * labScatterAmount;
}
`;
