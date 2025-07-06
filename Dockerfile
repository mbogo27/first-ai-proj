# Use a Deno base image
FROM denoland/deno:1.44.2

# Set the working directory inside the container
WORKDIR /app

# Copy deno.json and deno.jsonc (if you use it) to leverage Deno's caching
# This step helps in caching dependencies and speeds up subsequent builds
COPY deno.json .

# Copy your Deno backend file
COPY server.ts .

# Copy your frontend HTML file to be served by the Deno backend
COPY index.html .

# Copy your .env file for local development (Koyeb handles env vars differently)
# It's generally better to set environment variables directly in Koyeb's UI for production
COPY .env .

# Ensure npm dependencies are cached and downloaded
# This command will download and cache the npm dependencies specified in deno.json
# --check=all will ensure all dependencies are resolved
# --no-lock will prevent creation of a lock file in the image, as we're not committing it
RUN deno cache --check=all server.ts

# Expose the port your Deno application listens on (default 8000)
EXPOSE 8000

# Command to run your Deno application
# This uses the 'start' task defined in deno.json
CMD ["deno", "task", "start"]