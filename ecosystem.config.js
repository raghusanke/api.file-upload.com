module.exports = {
  apps: [
    {
      name: "api",
      script: "index.js",
      cwd: "/home/ec2-user/api.file-upload.com",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    },
    {
      name: "worker",
      script: "worker.js",
      cwd: "/home/ec2-user/api.file-upload.com",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
