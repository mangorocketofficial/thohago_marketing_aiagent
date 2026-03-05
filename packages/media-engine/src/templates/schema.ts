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
  optional?: boolean;
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
  align: "left" | "center" | "right";
};

export type TemplateConfig = {
  template_id: TemplateId;
  template_name: string;
  size: {
    width: number;
    height: number;
  };
  photos: TemplatePhotoSlot[];
  texts: TemplateTextSlot[];
  meta?: Record<string, unknown>;
};
