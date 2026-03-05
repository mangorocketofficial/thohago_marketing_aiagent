export type TemplateId =
  | "center-image-bottom-text"
  | "fullscreen-overlay"
  | "collage-2x2"
  | "text-only-gradient"
  | "split-image-text";

export type TemplateAspectRatio = "1:1" | "4:5" | "16:9";
export type TemplateImageFit = "cover" | "contain";

export type TemplateDefinition = {
  id: TemplateId;
  name: string;
  nameKo: string;
  description: string;
  width: number;
  height: number;
  aspectRatio: TemplateAspectRatio;
  thumbnail?: string;
  background: BackgroundDef;
  layers: TemplateLayers;
};

export type BackgroundDef =
  | { type: "solid"; color: string }
  | { type: "gradient"; colors: [string, string]; direction: "vertical" | "horizontal" | "diagonal" }
  | { type: "image"; placeholder: "user_photo" };

export type TemplateLayers = {
  userImageAreas?: TemplateImageArea[];
  darkOverlay?: {
    opacity: number;
  };
  mainText: TemplateTextLayer;
  subText?: TemplateTextLayer;
  brandLogo?: {
    x: number;
    y: number;
    w: number;
    h: number;
    opacity: number;
  };
};

export type TemplateImageArea = {
  x: number;
  y: number;
  w: number;
  h: number;
  fit: TemplateImageFit;
  borderRadius?: number;
};

export type TemplateTextLayer = {
  x: number;
  y: number;
  maxWidth: number;
  fontSize: number;
  fontWeight: "regular" | "bold";
  fontColor: string;
  align: "center" | "left" | "right";
  lineSpacing?: number;
};
