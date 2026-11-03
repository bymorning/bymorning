resource "aws_lb" "main" {
  name                       = "${var.name}-alb"
  internal                   = var.internal
  load_balancer_type         = "application"
  subnets                    = var.load_balancer_subnet_ids
  security_groups            = [aws_security_group.load_balancer.id]
  idle_timeout               = 120
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "main" {
  name_prefix          = "bm-"
  port                 = local.port
  protocol             = "HTTPS"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30
  health_check {
    path                = "/system/health"
    protocol            = "HTTPS"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  # TLS 1.3 and 1.2 only; the FIPS variant wherever FIPS endpoints are in use.
  ssl_policy      = local.fips ? "ELBSecurityPolicy-TLS13-1-2-FIPS-2023-04" : "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.main.arn
  }
}
