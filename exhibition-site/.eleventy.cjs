module.exports = function (eleventyConfig) {
  // Passthrough copy for static assets (exclude CSS — handled by Tailwind build)
  eleventyConfig.addPassthroughCopy({ 'exhibition-site/assets/images': 'assets/images' });
  eleventyConfig.addPassthroughCopy({ 'exhibition-site/assets/js': 'assets/js' });
  eleventyConfig.addPassthroughCopy({ 'exhibition-site/i18n': 'i18n' });
  eleventyConfig.addPassthroughCopy({ 'exhibition-site/favicon.ico': 'favicon.ico' });

  return {
    dir: {
      input: 'exhibition-site',
      output: 'exhibition-site/_site',
      data: '_data',
    },
    templateFormats: ['html', 'njk', 'md'],
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  };
};
