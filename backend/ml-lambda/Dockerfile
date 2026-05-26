FROM public.ecr.aws/lambda/python:3.11

# Install build tools
RUN yum update -y && \
    yum install -y gcc gcc-c++ && \
    yum clean all

# Copy and install dependencies
COPY requirements.txt .
RUN pip install -r requirements.txt --no-cache-dir

# Copy app code
COPY app.py .

CMD ["app.handler"]