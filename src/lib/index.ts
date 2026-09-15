const colours = [`primary`, `secondary`, `tertiary`];
const shades = [`100`, `200`, `300`, `400`, `500`, `600`, `700`, `800`, `900`];

/**
 * Returns primary/secondary/tertiary as colour and 100-900 value for intensity
 * @param value - block value based on which the colour is calculated
 * 
 * @returns colour and shade that a block with the provided value should have
 */
export const getTileColour = (value: number) => {
    const tier = Math.min(colours.length * shades.length, Math.max(0, Math.round(Math.log2(value)) - 1));

    const colour = colours[Math.floor(tier / shades.length)];
    const shade = shades[tier % shades.length];

    return { colour, shade };
};
