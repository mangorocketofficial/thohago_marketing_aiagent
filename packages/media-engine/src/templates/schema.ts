export type TemplateId = string;
export type TemplateImageFit = "cover" | "contain";

export type TemplatePhotoSlot = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fit: TemplateImageFit;
  z_index?: number;
};

export type TemplateTextSlot = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number;
  font_color: string;
  font_weight?: "normal" | "bold";
  font_style?: string;
  align: "left" | "center" | "right";
  example_text?: string;
};

export type TemplateBadge = {
  id: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "circle" | "rect";
  font_size: number;
  font_color: string;
  font_weight?: "normal" | "bold";
  z_index?: number;
  example_text?: string;
};

export type TemplateHeader = {
  logos: string[];
  tag?: string;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type TemplateConfig = {
  template_id: TemplateId;
  template_name: string;
  description: string;
  size: {
    width: number;
    height: number;
  };
  overlays: {
    photos: TemplatePhotoSlot[];
    texts: TemplateTextSlot[];
    badge?: TemplateBadge;
  };
  header?: TemplateHeader;
};
